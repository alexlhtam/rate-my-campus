import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateEnvironment } from "../build/private-env-plugin.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_getVarsForDev } = await import("wrangler");

test("native Worker loading resolves development and built-preview root environment files", async () => {
  await mkdir(path.join(root, ".sites-runtime"), { recursive: true });
  const fixture = await mkdtemp(path.join(root, ".sites-runtime", "env-test-"));
  try {
    await mkdir(path.join(fixture, "dist", "server"), { recursive: true });
    // Harmless synthetic values only; never read the developer's real .env.
    await writeFile(path.join(fixture, ".env"), "ENV_TEST_SERVER_KEY=fixture-base\nENV_TEST_OPTIONAL=\n");
    await writeFile(path.join(fixture, ".env.local"), "ENV_TEST_SERVER_KEY=fixture-override\n");
    await writeFile(path.join(fixture, "dist", "server", ".dev.vars"), "ENV_TEST_SERVER_KEY=stale-build-snapshot\n");
    const development = unstable_getVarsForDev(path.join(fixture, "wrangler.json"), undefined, {}, undefined, true);
    const preview = unstable_getVarsForDev(path.join(fixture, "dist", "server", "wrangler.json"), [path.join(fixture, ".env"), path.join(fixture, ".env.local")], {}, undefined, true);
    for (const result of [development, preview]) {
      assert.equal(result.ENV_TEST_SERVER_KEY.value, "fixture-override");
      assert.equal(result.ENV_TEST_SERVER_KEY.type, "secret_text");
      assert.equal(result.ENV_TEST_OPTIONAL.value, "");
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("environment files are ignored and the example contains every supported server setting", async (context) => {
  const git = spawnSync("git", ["check-ignore", "--stdin"], { cwd: root, input: ".env\n.env.local\n.dev.vars\n.env.example\n", encoding: "utf8" });
  if (git.error?.code === "ENOENT") context.diagnostic("Git is unavailable; ignore-rule check skipped.");
  else {
    assert.equal(git.status, 0);
    assert.deepEqual(git.stdout.trim().split(/\r?\n/), [".env", ".env.local", ".dev.vars"]);
  }
  const template = await readFile(path.join(root, ".env.example"), "utf8");
  const settings = Object.fromEntries([...template.matchAll(/^([A-Z_]+)=(.*)$/gm)].map((match) => [match[1], match[2].trim()]));
  assert.deepEqual(Object.keys(settings).sort(), ["ADMIN_USER_IDS", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_WORKSPACE_ID", "EMAIL_FROM", "GOOGLE_MAPS_API_KEY", "RESEND_API_KEY", "UNION_IMPORT_ENABLED"].sort());
  for (const [name, value] of Object.entries(settings)) {
    assert.equal(/^(VITE_|NEXT_PUBLIC_)/.test(name), false);
    if (!["ANTHROPIC_MODEL", "UNION_IMPORT_ENABLED"].includes(name)) assert.equal(value, "");
  }
});

test("browser environment injection is disabled and local secret snapshots cannot enter build output", () => {
  const plugin = privateEnvironment();
  assert.deepEqual(plugin.config().envPrefix, []);
  const bundle = { ".dev.vars": { source: "fixture" }, "nested/.env.local": { source: "fixture" }, "index.js": { code: "export {}" }, ".assetsignore": { source: "" } };
  plugin.generateBundle({}, bundle);
  assert.deepEqual(Object.keys(bundle), ["index.js", ".assetsignore"]);
});
