import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

export const ROOT = process.env.MERGEALERT_HOME || join(homedir(), '.mergealert');
export const REPOS_DIR = join(ROOT, 'repos');
const CONFIG_FILE = join(ROOT, 'config.json');

const DEFAULTS = { intervalMs: 60_000, watches: [] };

export function ensureDirs() {
  mkdirSync(REPOS_DIR, { recursive: true });
}

export function load() {
  ensureDirs();
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(config) {
  ensureDirs();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Turn a clone URL into a stable, filesystem-safe directory name.
export function slugFor(url) {
  return url
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export function repoPath(url) {
  return join(REPOS_DIR, slugFor(url) + '.git');
}
