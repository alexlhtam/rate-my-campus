import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Supabase's project URL and anon key are designed to be public; nothing else may be.
const PUBLIC_SETTINGS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

test("environment files are ignored and the example contains every supported server setting", async (context) => {
  const git = spawnSync("git", ["check-ignore", "--stdin"], { cwd: root, input: ".env\n.env.local\n.dev.vars\n.env.example\n", encoding: "utf8" });
  if (git.error?.code === "ENOENT") context.diagnostic("Git is unavailable; ignore-rule check skipped.");
  else {
    assert.equal(git.status, 0);
    assert.deepEqual(git.stdout.trim().split(/\r?\n/), [".env", ".env.local", ".dev.vars"]);
  }
  const template = await readFile(path.join(root, ".env.example"), "utf8");
  const settings = Object.fromEntries([...template.matchAll(/^([A-Z_]+)=(.*)$/gm)].map((match) => [match[1], match[2].trim()]));
  assert.deepEqual(Object.keys(settings).sort(), ["ADMIN_USER_IDS", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_WORKSPACE_ID", "CRON_SECRET", "FREEBIE_CLAUDE_MODEL", "FREEBIE_DAILY_IMPORT_ENABLED", "FREEBIE_JEV_SCREENING", "FREEBIE_WORKER_URL", "JEV_API_KEY", "JEV_MODEL", "JEV_THRESHOLD", "GOOGLE_MAPS_API_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "POSTGRES_URL", "SUPABASE_SERVICE_ROLE_KEY", "UNION_IMPORT_ENABLED"].sort());
  assert.equal(settings.FREEBIE_DAILY_IMPORT_ENABLED, "false");
  assert.equal(settings.FREEBIE_JEV_SCREENING, "false");
  for (const [name, value] of Object.entries(settings)) {
    if (/^(VITE_|NEXT_PUBLIC_)/.test(name)) assert.ok(PUBLIC_SETTINGS.includes(name), `${name} would be exposed to browsers`);
    if (!["ANTHROPIC_MODEL", "UNION_IMPORT_ENABLED", "FREEBIE_DAILY_IMPORT_ENABLED", "FREEBIE_JEV_SCREENING", "JEV_MODEL", "JEV_THRESHOLD"].includes(name)) assert.equal(value, "");
  }
});

test("server secrets are never read through browser-exposed names", async () => {
  for (const file of ["lib/supabase.ts", "lib/db.ts", "lib/integrations.ts", "lib/community-server.ts"]) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const [, name] of source.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z_]+)/g)) {
      assert.ok(PUBLIC_SETTINGS.includes(name) || name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `${file} reads ${name}`);
    }
  }
});
