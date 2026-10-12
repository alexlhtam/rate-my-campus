import http from "node:http";
import net from "node:net";
import os from "node:os";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const demoState = { reviews: [], posts: [], threads: [], replies: [], votes: [], myVotes: [], profile: { verified: false, signedIn: false, isAdmin: false }, services: { email: false, ai: false, google: false } };
const demoMap = { provider: "openstreetmap", attribution: "© OpenStreetMap contributors", tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", notice: "Local Wi-Fi demo uses OpenStreetMap." };

export function parseArgs(args) {
  const result = { host: undefined, port: 3000, workerPort: 8787, help: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") { result.help = true; continue; }
    if (!["--host", "--port", "--worker-port"].includes(flag) || !args[index + 1]) throw new Error(`Unknown or incomplete option: ${flag}`);
    const value = args[++index];
    if (flag === "--host") {
      if (net.isIPv4(value) === false) throw new Error("--host must be this computer's LAN IPv4 address.");
      result.host = value;
    } else {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${flag} must be a port between 1 and 65535.`);
      result[flag === "--port" ? "port" : "workerPort"] = port;
    }
  }
  return result;
}

export function selectInterface(interfaces, requestedHost) {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries || []).filter((entry) => !entry.internal && (entry.family === "IPv4" || entry.family === 4) && net.isIPv4(entry.address) && !entry.address.startsWith("169.254.")).map((entry) => ({ ...entry, name })));
  const score = (entry) => (/wi-?fi|wlan|wireless/i.test(entry.name) ? 100 : 0) - (/virtual|docker|veth|vpn|wsl|loopback/i.test(entry.name) ? 200 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  const selected = requestedHost ? candidates.find((entry) => entry.address === requestedHost) : candidates[0];
  if (!selected) throw new Error(requestedHost ? "--host must match an active, non-loopback IPv4 interface on this computer." : "No LAN IPv4 interface was found. Connect to Wi-Fi or Ethernet first.");
  const mask = ipv4Number(selected.netmask);
  const inverted = (~mask) >>> 0;
  if (!net.isIPv4(selected.netmask) || mask === 0 || (inverted & (inverted + 1)) !== 0) throw new Error("This interface has an unsupported netmask; choose another --host.");
  return selected;
}

function ipv4Number(value) { return String(value).split(".").reduce((number, part) => (number * 256 + Number(part)) >>> 0, 0); }
export function sameSubnet(remoteAddress, address, netmask) {
  const remote = (remoteAddress || "").replace(/^::ffff:/, "");
  return net.isIPv4(remote) && (ipv4Number(remote) & ipv4Number(netmask)) === (ipv4Number(address) & ipv4Number(netmask));
}

export function routeRequest(method, rawPath) {
  if (method !== "GET" && method !== "HEAD") return { kind: "blocked", status: 403, error: "This Wi-Fi demo saves sample activity only on your device. Live account and service actions are unavailable." };
  if (!rawPath?.startsWith("/") || rawPath.startsWith("//") || /%(?:2f|5c|25)/i.test(rawPath)) return { kind: "blocked", status: 400, error: "Invalid request path." };
  let url;
  try { url = new URL(rawPath, "http://local.invalid"); } catch { return { kind: "blocked", status: 400, error: "Invalid request path." }; }
  if (url.origin !== "http://local.invalid") return { kind: "blocked", status: 400, error: "Invalid request path." };
  if (url.pathname === "/api/community/state") return { kind: "json", status: 200, body: demoState };
  if (url.pathname === "/api/map/provider") return { kind: "json", status: 200, body: demoMap };
  if (url.pathname.startsWith("/api/")) return { kind: "blocked", status: 503, error: "Live services are unavailable in the local Wi-Fi demo." };
  if (url.pathname === "/" || url.pathname === "/favicon.svg" || ["/_next/static/", "/data/", "/images/"].some((prefix) => url.pathname.startsWith(prefix))) return { kind: "proxy", path: url.pathname + url.search };
  return { kind: "blocked", status: 404, error: "This route is unavailable in the local Wi-Fi demo." };
}

export function forwardHeaders(incoming, workerPort) {
  const headers = { host: `127.0.0.1:${workerPort}` };
  for (const name of ["accept", "accept-language", "user-agent"]) if (incoming[name]) headers[name] = incoming[name];
  return headers;
}

function respond(req, res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
}

function freePort(host, port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${host}:${port} is already in use. Choose another port; existing processes will not be stopped.`)));
    probe.listen({ host, port, exclusive: true }, () => probe.close(resolve));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log("Usage: npm run lan -- [--host LAN_IP] [--port 3000] [--worker-port 8787]\nRequires a completed npm run build. Shares an isolated browser-local demo, not live accounts or paid APIs."); return; }
  const iface = selectInterface(os.networkInterfaces(), options.host);
  if (!existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("Build the app first: npm ci, then npm run build.");
  await freePort("127.0.0.1", options.workerPort);
  await freePort(iface.address, options.port);

  const worker = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(options.workerPort)], {
    cwd: root, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32", env: { ...process.env },
  });
  let stopped = false, workerExited = false;
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, (req, res) => {
    if (!sameSubnet(req.socket.remoteAddress, iface.address, iface.netmask)) return respond(req, res, 403, { error: "Same-subnet access only." });
    if (req.headers.host !== `${iface.address}:${options.port}` && !(options.port === 80 && req.headers.host === iface.address)) return respond(req, res, 403, { error: "Use the LAN address printed by the launcher." });
    const route = routeRequest(req.method, req.url);
    if (route.kind !== "proxy") return respond(req, res, route.status, route.kind === "json" ? route.body : { error: route.error });
    // A strict display-header allowlist excludes identity headers, cookies,
    // credentials, proxy headers and server-action headers, including duplicates.
    const upstream = http.request({ hostname: "127.0.0.1", port: options.workerPort, path: route.path, method: req.method, headers: forwardHeaders(req.headers, options.workerPort), timeout: 15000 }, (reply) => {
      const headers = { ...reply.headers }; delete headers["set-cookie"];
      res.writeHead(reply.statusCode || 502, headers); reply.pipe(res);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => { if (!res.headersSent) respond(req, res, 502, { error: "The local server is starting. Refresh in a moment." }); else res.destroy(); });
    res.on("close", () => upstream.destroy());
    upstream.end();
  });
  server.on("upgrade", (_request, socket) => socket.destroy());

  function stopWorker() {
    if (workerExited || !worker.pid) return;
    // Only stop the child process tree created by this launcher.
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-worker.pid, "SIGTERM");
    } catch { /* The child may have exited between the check and signal. */ }
  }
  function stop(code = 0) {
    if (stopped) return;
    stopped = true; process.exitCode = code;
    server.close(); server.closeAllConnections(); stopWorker();
  }
  worker.once("error", (error) => { console.error(error.message); stop(1); });
  worker.once("exit", (code) => { workerExited = true; if (!stopped) { console.error("The local server stopped."); stop(code || 1); } });
  server.once("error", (error) => { console.error(error.message); stop(1); });
  process.once("SIGINT", () => stop()); process.once("SIGTERM", () => stop());
  process.once("exit", stopWorker);
  server.listen(options.port, iface.address, () => {
    console.log(`\nRate My Campus Wi-Fi demo: http://${iface.address}:${options.port}\nInterface: ${iface.name}; subnet mask: ${iface.netmask}.\nWait for Next.js's ready message, then open the address on the same network.\nDemo activity stays separately on each device. Live accounts, admin actions and paid APIs are blocked.\nPress Ctrl+C to stop both the proxy and its local server.\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
