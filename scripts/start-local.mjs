import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";
import { localEnvArgs } from "./local-env.mjs";

const worker = spawn(process.execPath, [
  path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
  "dev", "--config", "dist/server/wrangler.json", ...localEnvArgs(projectRoot),
  "--local", "--persist-to", ".wrangler/state", "--ip", "127.0.0.1", "--inspector-port", "0",
  ...process.argv.slice(2),
], { cwd: projectRoot, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });

let exited = false;
function stop() {
  if (exited || !worker.pid) return;
  // Only clean up the process tree created by this launcher.
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-worker.pid, "SIGTERM");
  } catch { /* The child may already have stopped. */ }
}
worker.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
worker.once("exit", (code) => { exited = true; process.exitCode = code ?? 0; });
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("exit", stop);
