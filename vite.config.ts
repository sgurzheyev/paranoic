import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Serve /api weather-traffic proxies during `npm run dev` (same handlers as Vercel). */
function paranoicApiDev(): Plugin {
  const routes = new Set(['opensky-states', 'adsb-nearby', 'ais-nearby']);
  return {
    name: 'paranoic-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || '';
        const pathname = raw.split('?')[0] || '';
        const name = pathname.startsWith('/api/') ? pathname.slice(5) : '';
        if (!routes.has(name)) {
          next();
          return;
        }
        try {
          const mod = (await server.ssrLoadModule(path.join(root, 'api', `${name}.ts`))) as {
            GET?: (request: Request) => Promise<Response> | Response;
            OPTIONS?: (request: Request) => Response;
          };
          const method = (req.method || 'GET').toUpperCase();
          const request = new Request(`http://127.0.0.1${raw}`, { method });
          const response =
            method === 'OPTIONS' ? mod.OPTIONS?.(request) : await mod.GET?.(request);
          if (!response) {
            next();
            return;
          }
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'api failed',
              states: [],
              ac: [],
              ships: [],
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), paranoicApiDev()],
});
