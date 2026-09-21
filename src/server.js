import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as watcher from './watcher.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (rel.startsWith('..')) return json(res, 403, { error: 'forbidden' });
  try {
    const file = await readFile(join(PUBLIC_DIR, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/state') {
    const config = watcher.getConfig();
    return json(res, 200, { watches: watcher.getWatches(), intervalMs: config.intervalMs });
  }

  if (method === 'GET' && pathname === '/api/branches') {
    const repo = url.searchParams.get('url');
    if (!repo) return json(res, 400, { error: 'url query param required' });
    return json(res, 200, await watcher.branchesFor(repo));
  }

  if (method === 'POST' && pathname === '/api/watches') {
    const body = await readBody(req);
    return json(res, 201, await watcher.addWatch(body));
  }

  if (method === 'POST' && pathname === '/api/check') {
    return json(res, 200, { watches: await watcher.checkAll() });
  }

  if (method === 'POST' && pathname === '/api/settings') {
    const body = await readBody(req);
    watcher.setInterval_(body.intervalMs);
    return json(res, 200, { intervalMs: watcher.getConfig().intervalMs });
  }

  const check = pathname.match(/^\/api\/watches\/([\w-]+)\/check$/);
  if (method === 'POST' && check) {
    const watch = await watcher.checkOne(check[1]);
    return watch ? json(res, 200, watch) : json(res, 404, { error: 'not found' });
  }

  const one = pathname.match(/^\/api\/watches\/([\w-]+)$/);
  if (method === 'DELETE' && one) {
    return watcher.removeWatch(one[1])
      ? json(res, 200, { ok: true })
      : json(res, 404, { error: 'not found' });
  }

  if (method === 'DELETE' && pathname === '/api/watches') {
    const count = watcher.removeAllWatches();
    return json(res, 200, { ok: true, removed: count });
  }

  return json(res, 404, { error: 'unknown endpoint' });
}

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      return await serveStatic(res, url.pathname);
    } catch (err) {
      json(res, 500, { error: String(err.message || err).split('\n')[0] });
    }
  });
}

export function startServer({ port = 4321, host = '127.0.0.1' } = {}) {
  const server = createApp();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      watcher.start();
      resolve(server);
    });
  });
}
