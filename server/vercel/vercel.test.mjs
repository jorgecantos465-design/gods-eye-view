import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rehydrateBody, resolveRequestUrl } from './adapter.js';
import { createMountRouter } from './router.js';

function mockResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.headersSent = true;
      this.writableEnded = true;
      if (chunk !== undefined) this.body += chunk;
    },
  };
}

test('mounted provider receives the path remainder', () => {
  const router = createMountRouter();
  let seenUrl;
  router.use('/api/firms', (req, res) => {
    seenUrl = req.url;
    res.end('ok');
  });

  const res = mockResponse();
  router.handle({ url: '/api/firms/status?x=1', headers: {} }, res);

  assert.equal(seenUrl, '/status?x=1');
  assert.equal(res.body, 'ok');
});

test('next restores the original URL before the next middleware', () => {
  const router = createMountRouter();
  const seen = [];
  router.use('/api/x', (req, _res, next) => {
    seen.push(req.url);
    next();
  });
  router.use((req, res) => {
    seen.push(req.url);
    res.end();
  });

  router.handle({ url: '/api/x/child', headers: {} }, mockResponse());
  assert.deepEqual(seen, ['/child', '/api/x/child']);
});

test('a mount does not match a longer unrelated prefix', () => {
  const router = createMountRouter();
  let matched = false;
  router.use('/api/firms', (_req, res) => {
    matched = true;
    res.end();
  });
  const res = mockResponse();

  router.handle({ url: '/api/firmsx', headers: {} }, res);

  assert.equal(matched, false);
  assert.equal(res.statusCode, 404);
});

test('Vercel rewrite path and caller query are reconstructed', () => {
  const req = {
    query: {
      __gev_api_path: 'celestrak/stations',
      group: 'active',
      limit: ['10', '20'],
    },
  };

  assert.equal(
    resolveRequestUrl(req),
    '/api/celestrak/stations?group=active&limit=10&limit=20',
  );
});

test('parsed JSON bodies are replayed for provider body readers', async () => {
  const req = {
    headers: { 'content-type': 'application/json' },
    body: { query: 'node(1);out;' },
  };
  rehydrateBody(req);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), {
    query: 'node(1);out;',
  });
});

test('parsed form bodies are re-encoded as form data', async () => {
  const req = {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { data: '[out:json];node(1);out;' },
  };
  rehydrateBody(req);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));

  assert.equal(params.get('data'), '[out:json];node(1);out;');
});

test('Vercel config keeps API requests out of the SPA fallback', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
  );

  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.rewrites[0].source, '/api/:__gev_api_path*');
  assert.match(config.rewrites[1].source, /api/);
  assert.equal(config.functions['api/route.js'].maxDuration, 60);
});
