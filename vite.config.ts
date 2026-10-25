import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

type WebHandler = (request: Request) => Promise<Response> | Response;
type IdeasModule = Partial<Record<'GET' | 'POST' | 'OPTIONS', WebHandler>>;

const API_FILE = resolve(__dirname, 'api/ideas.ts');
const MAX_DEV_BODY = 64 * 1024;

/** Converts a Node request into a WHATWG Request so the same Vercel handler runs locally. */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_DEV_BODY) break;
    chunks.push(buf);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const method = req.method ?? 'GET';
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  return new Request(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Serves /api/ideas during `vite dev` and `vite preview` with the exact handler deployed to Vercel,
 * so the ideas form can be tested locally with and without IDEAS_WEBHOOK_URL.
 */
function localApi(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.IDEAS_WEBHOOK_URL && !process.env.IDEAS_WEBHOOK_URL) {
    process.env.IDEAS_WEBHOOK_URL = env.IDEAS_WEBHOOK_URL;
  }

  const middleware =
    (load: () => Promise<IdeasModule>) =>
    async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
      if (!req.url || !req.url.startsWith('/api/ideas')) return next();
      try {
        const mod = await load();
        const handler = mod[(req.method ?? 'GET') as keyof IdeasModule];
        if (!handler) {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, POST, OPTIONS');
          res.end();
          return;
        }
        await sendWebResponse(res, await handler(await toWebRequest(req)));
      } catch (error) {
        console.error('[api/ideas] local handler failed', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, code: 'server_error', message: 'Falha interna no servidor local.' }));
      }
    };

  return {
    name: 'linha-morta-local-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware(() => server.ssrLoadModule(API_FILE) as Promise<IdeasModule>));
    },
    configurePreviewServer(server) {
      // Node >= 22.18 strips TypeScript types natively; api/ideas.ts has no relative imports.
      server.middlewares.use(middleware(() => import(pathToFileURL(API_FILE).href) as Promise<IdeasModule>));
    },
  };
}

/** Mirrors the security headers from vercel.json in `vite preview` so production behaviour can be tested locally. */
function vercelHeaders(): Record<string, string> {
  try {
    const config = JSON.parse(readFileSync(resolve(__dirname, 'vercel.json'), 'utf8')) as {
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };
    const global = config.headers?.find((h) => h.source === '/(.*)');
    return Object.fromEntries((global?.headers ?? []).map((h) => [h.key, h.value]));
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  preview: {
    headers: vercelHeaders(),
  },
  plugins: [
    localApi(mode),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'LINHA MORTA',
        short_name: 'LINHA MORTA',
        description: 'O mundo não esquece você. Sobrevivência e suspense psicológico em uma estrada abandonada.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        theme_color: '#07090c',
        background_color: '#030405',
        categories: ['games', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell is precached (code, styles, icons and the Latin font subsets actually used).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        globIgnores: ['**/node_modules/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'linha-morta-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
}));
