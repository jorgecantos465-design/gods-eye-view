import os from 'node:os';
import { createMountRouter } from './router.js';

let apiPromise;
let cwdPrepared = false;

function prepareWritableCacheDirectory() {
  if (cwdPrepared) return;
  cwdPrepared = true;
  try {
    process.chdir(os.tmpdir());
  } catch (error) {
    console.warn(
      '[vercel] could not switch provider caches to a writable directory:',
      error?.message || error,
    );
  }
}

function unavailable(feature, message) {
  return (_req, res) => {
    res.statusCode = 501;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'unavailable_in_serverless', feature, message }));
  };
}

async function createVercelApi() {
  prepareWritableCacheDirectory();

  const [{ localProviderPlugins }, { apiNotFoundPlugin }] = await Promise.all([
    import('../providers/local.js'),
    import('../standalone/api-not-found.js'),
  ]);

  const router = createMountRouter();
  const server = {
    middlewares: router,
    httpServer: undefined,
    config: {},
    restart() {
      return Promise.resolve();
    },
  };

  router.use(
    '/api/ais-live',
    unavailable(
      'ais-live',
      'The persistent AIS websocket relay is not supported by this serverless deployment',
    ),
  );

  router.use('/api/realtime/debug-log', (_req, res) => {
    res.statusCode = 204;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  });

  const skipped = new Set(['gev-key-setup', 'ais-live-proxy']);
  for (const plugin of localProviderPlugins()) {
    if (skipped.has(plugin.name)) continue;
    if (typeof plugin.configureServer === 'function') {
      await plugin.configureServer(server);
    }
  }

  apiNotFoundPlugin().configureServer(server);

  return {
    handle(req, res) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        res.once('finish', finish);
        res.once('close', finish);
        router.handle(req, res);
      });
    },
  };
}

function getVercelApi() {
  if (!apiPromise) apiPromise = createVercelApi();
  return apiPromise;
}

export { createVercelApi, getVercelApi };
