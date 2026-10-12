import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Copy MapLibre's self-contained, published module worker into public/ as
 * opaque bytes, so Next.js serves it unbundled. No worker source is rewritten.
 * The package BSD-3-Clause and bundled dependency notices are copied beside it.
 */
export async function copyMapWorker(root = fileURLToPath(new URL("../", import.meta.url))) {
  const require = createRequire(path.join(root, "package.json"));
  const packagePath = require.resolve("maplibre-gl/package.json");
  const packageRoot = path.dirname(packagePath);
  const { version } = JSON.parse(await readFile(packagePath, "utf8"));
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
    throw new Error("MapLibre package version cannot form a safe worker asset filename");
  }
  const directory = path.join(root, "public", "vendor");
  await mkdir(directory, { recursive: true });
  const files = [
    [path.join(packageRoot, "dist/maplibre-gl-worker.mjs"), path.join(directory, `maplibre-worker-${version}.mjs`)],
    [path.join(packageRoot, "LICENSE.txt"), path.join(directory, `maplibre-worker-${version}.LICENSE.txt`)],
  ];
  for (const [from, to] of files) await copyFile(from, to);
  return files.map(([, to]) => to);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await copyMapWorker();
