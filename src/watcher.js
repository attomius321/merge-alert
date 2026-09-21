import { randomUUID } from 'node:crypto';
import { load, save } from './store.js';
import { checkMerged, ensureClone, defaultBranch, listBranches } from './git.js';
import { notify } from './notify.js';

let config = load();
let timer = null;
let running = false;

export function getConfig() {
  return config;
}

export function getWatches() {
  return config.watches;
}

function persist() {
  save(config);
}

export async function addWatch({ url, branch, target }) {
  if (!url || !branch) throw new Error('url and branch are required');
  await ensureClone(url);
  const resolvedTarget = target || (await defaultBranch(url));

  const duplicate = config.watches.find(
    (w) => w.url === url && w.branch === branch && w.target === resolvedTarget,
  );
  if (duplicate) return duplicate;

  const watch = {
    id: randomUUID(),
    url,
    branch,
    target: resolvedTarget,
    status: 'pending',
    detail: 'not checked yet',
    lastShared: null,
    lastChecked: null,
    notifiedAt: null,
    createdAt: new Date().toISOString(),
  };
  config.watches.push(watch);
  persist();
  checkOne(watch.id).catch(() => {});
  return watch;
}

export function removeWatch(id) {
  const before = config.watches.length;
  config.watches = config.watches.filter((w) => w.id !== id);
  if (config.watches.length === before) return false;
  persist();
  return true;
}

export async function branchesFor(url) {
  await ensureClone(url);
  return { branches: await listBranches(url), default: await defaultBranch(url) };
}

export async function checkOne(id) {
  const watch = config.watches.find((w) => w.id === id);
  if (!watch) return null;

  const previous = watch.status;
  try {
    const { status, detail, lastShared } = await checkMerged(watch.url, watch.branch, watch.target);
    watch.status = status;
    watch.detail = detail;
    watch.lastShared = lastShared ?? null;
  } catch (err) {
    watch.status = 'error';
    watch.detail = String(err.message || err).split('\n')[0];
    watch.lastShared = null;
  }
  watch.lastChecked = new Date().toISOString();

  // Notify once, on the transition into a landed state.
  const landed = watch.status === 'merged' || watch.status === 'gone';
  if (landed && previous !== watch.status && !watch.notifiedAt) {
    watch.notifiedAt = new Date().toISOString();
    const verb = watch.status === 'merged' ? 'merged into' : 'gone from';
    await notify(`${watch.branch} ${verb} ${watch.target}`, `${watch.url}\n${watch.detail}`);
  }

  persist();
  return watch;
}

export async function checkAll() {
  if (running) return config.watches;
  running = true;
  try {
    for (const watch of config.watches) {
      await checkOne(watch.id);
    }
  } finally {
    running = false;
  }
  return config.watches;
}

export function setInterval_(ms) {
  config.intervalMs = Math.max(10_000, Number(ms) || 60_000);
  persist();
  start();
}

export function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    checkAll().catch((err) => console.error('[watcher]', err.message));
  }, config.intervalMs);
  timer.unref?.();
  checkAll().catch((err) => console.error('[watcher]', err.message));
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
