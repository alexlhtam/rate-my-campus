import { statSync } from "node:fs";
import path from "node:path";

// Wrangler forwards explicit --env-file arguments to Node as well as its Worker
// loader. Node requires each explicit file to exist. Keep overrides last and
// use absolute paths so the built configuration's directory cannot change them.
export function localEnvArgs(root) {
  return [".env", ".env.local"].flatMap((name) => {
    const filename = path.join(root, name);
    try { return statSync(filename).isFile() ? ["--env-file", filename] : []; }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  });
}
