import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Serve MapLibre's self-contained, published module worker as opaque bytes.
 * Running it through Vite's module pipeline injects browser HMR code into the
 * worker in development. The same package bytes are emitted as a client asset
 * in production. No node_modules files or worker source are rewritten.
 *
 * The package BSD-3-Clause and bundled dependency notices are distributed beside
 * the worker. MapLibre's copyright banner remains intact in the original file.
 */
export function mapWorker() {
  let assets = [];
  let resolved;

  return {
    name: 'campus-maplibre-raw-worker',
    enforce: 'pre',
    async configResolved(config) {
      resolved = config;
      const require = createRequire(path.join(config.root, 'package.json'));
      const packagePath = require.resolve('maplibre-gl/package.json');
      const packageRoot = path.dirname(packagePath);
      const { version } = JSON.parse(await readFile(packagePath, 'utf8'));
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
        throw new Error('MapLibre package version cannot form a safe worker asset filename');
      }
      const [worker, license] = await Promise.all([
        readFile(path.join(packageRoot, 'dist/maplibre-gl-worker.mjs')),
        readFile(path.join(packageRoot, 'LICENSE.txt')),
      ]);
      assets = [
        { fileName: `_next/static/maplibre-worker-${version}.mjs`, source: worker, contentType: 'text/javascript; charset=utf-8' },
        { fileName: `_next/static/maplibre-worker-${version}.LICENSE.txt`, source: license, contentType: 'text/plain; charset=utf-8' },
      ];
    },
    configureServer(server) {
      // Register before Vite's transform middleware, including ?v/cache queries.
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        const base = resolved.base.startsWith('/') ? resolved.base : '/';
        const asset = assets.find(item => pathname === `${base}${item.fileName}`);
        if (!asset) return next();
        response.statusCode = 200;
        response.setHeader('Content-Type', asset.contentType);
        response.setHeader('Content-Length', String(asset.source.byteLength));
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(request.method === 'HEAD' ? undefined : asset.source);
      });
    },
    generateBundle() {
      // Vinext builds client, SSR and RSC environments. Only browser assets are
      // served under /_next/static; emitting into server bundles is unnecessary.
      const environmentName = this.environment?.name;
      if (environmentName ? environmentName !== 'client' : resolved.build.ssr) return;
      for (const asset of assets) {
        this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source });
      }
    },
  };
}
