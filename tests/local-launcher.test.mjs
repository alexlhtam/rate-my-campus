import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { localEnvArgs } from "../scripts/local-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, ".sites-runtime");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("real Wrangler launch tolerates missing optional env files and applies local overrides", { timeout: 90_000 }, async (context) => {
  await mkdir(runtime, { recursive: true });
  for (const setup of ["no-files", "base-only", "local-override"]) {
    await context.test(setup, { timeout: 28_000 }, async () => {
      // A space in this path checks argument handling on Windows. Every value is
      // a synthetic test marker; the developer's private .env is never loaded.
      const fixture = await mkdtemp(path.join(runtime, "env launch-"));
      let worker;
      try {
        if (setup !== "no-files") await writeFile(path.join(fixture, ".env"), "CAMPUS_LAUNCH_TEST_MARKER=base\n");
        if (setup === "local-override") await writeFile(path.join(fixture, ".env.local"), "CAMPUS_LAUNCH_TEST_MARKER=local\n");
        const envArgs = localEnvArgs(fixture);
        assert.deepEqual(envArgs, setup === "no-files" ? [] : setup === "base-only" ? ["--env-file", path.join(fixture, ".env")] : ["--env-file", path.join(fixture, ".env"), "--env-file", path.join(fixture, ".env.local")]);
        await writeFile(path.join(fixture, "worker.mjs"), 'export default { fetch(_request, env) { return Response.json({ marker: env.CAMPUS_LAUNCH_TEST_MARKER || null }); } };\n');
        await writeFile(path.join(fixture, "wrangler.json"), JSON.stringify({ name: "campus-launch-test", main: "worker.mjs", compatibility_date: "2026-05-15" }));
        const port = await availablePort();
        worker = spawn(process.execPath, [wrangler, "dev", "--config", path.join(fixture, "wrangler.json"), ...envArgs, "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], {
          cwd: fixture, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
          env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_PATH: path.join(fixture, "logs"), WRANGLER_REGISTRY_PATH: path.join(fixture, "registry"), MINIFLARE_REGISTRY_PATH: path.join(fixture, "registry") },
        });
        worker.stdout.resume(); worker.stderr.resume();
        let launchError;
        worker.once("error", error => { launchError = error; });
        let response;
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          if (launchError) throw launchError;
          assert.equal(worker.exitCode, null, "Wrangler exited before serving the fixture");
          try { response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(600) }); if (response.ok) break; } catch { /* Wait for this test's isolated listener. */ }
          await delay(100);
        }
        assert.ok(response?.ok, "Wrangler must serve successfully with this environment-file combination");
        assert.deepEqual(await response.json(), { marker: setup === "no-files" ? null : setup === "base-only" ? "base" : "local" });
      } finally {
        if (worker?.pid && worker.exitCode === null) {
          if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          else { try { process.kill(-worker.pid, "SIGTERM"); } catch {} }
          await Promise.race([new Promise(resolve => worker.once("exit", resolve)), delay(1500)]);
        }
        assert.ok(path.resolve(fixture).startsWith(path.resolve(runtime) + path.sep));
        await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
  }
});
