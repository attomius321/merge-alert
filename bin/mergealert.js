#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { startServer } from '../src/server.js';
import * as watcher from '../src/watcher.js';
import { ROOT } from '../src/store.js';

const argv = process.argv.slice(2);

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

function usage() {
  console.log(`mergealert - watch git branches, get notified when they land

Usage:
  mergealert [--port 4321] [--host 127.0.0.1] [--open]   start the web UI + watcher
  mergealert add <repo-url> <branch> [target]            add a watch from the terminal
  mergealert list                                        show current watches
  mergealert rm <id>                                     remove a watch
  mergealert rm --all                                    remove all watches
  mergealert check                                       check every watch once, then exit

Clones live in ${ROOT}`);
}

function open(url) {
  for (const cmd of ['xdg-open', 'explorer.exe', 'open']) {
    execFile(cmd, [url], () => {});
  }
}

const STATUS_LABEL = { merged: 'MERGED', gone: 'GONE  ', open: 'open  ', pending: 'pending', error: 'ERROR ' };

function printWatches(watches) {
  if (!watches.length) return console.log('no watches yet');
  for (const w of watches) {
    console.log(`${STATUS_LABEL[w.status] || w.status}  ${w.branch} -> ${w.target}  ${w.url}`);
    console.log(`        ${w.detail || ''}`);
    if (w.lastShared) {
      const { sha, subject, relative, date } = w.lastShared;
      console.log(`        last shared with ${w.target}: ${sha} ${subject} (${date.slice(0, 10)}, ${relative})`);
    }
    console.log(`        id: ${w.id}`);
  }
}

const [command] = argv;

try {
  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
    usage();
  } else if (command === 'add') {
    const [, url, branch, target] = argv;
    if (!url || !branch) {
      usage();
      process.exit(1);
    }
    console.log(`cloning / fetching ${url} ...`);
    const watch = await watcher.addWatch({ url, branch, target });
    const checked = await watcher.checkOne(watch.id);
    printWatches([checked || watch]);
  } else if (command === 'list') {
    printWatches(watcher.getWatches());
  } else if (command === 'rm') {
    if (argv[1] === '--all') {
      const count = watcher.removeAllWatches();
      console.log(count ? `removed all ${count} watch(es)` : 'no watches to remove');
    } else {
      console.log(watcher.removeWatch(argv[1]) ? 'removed' : 'no watch with that id');
    }
  } else if (command === 'check') {
    printWatches(await watcher.checkAll());
  } else if (!command || command.startsWith('--')) {
    const port = Number(flag('port', process.env.MERGEALERT_PORT || 4321));
    const host = flag('host', '127.0.0.1');
    await startServer({ port, host });
    const url = `http://${host}:${port}`;
    console.log(`mergealert running at ${url}`);
    console.log(`clones: ${ROOT}   interval: ${watcher.getConfig().intervalMs / 1000}s`);
    if (argv.includes('--open')) open(url);
  } else {
    usage();
    process.exit(1);
  }
} catch (err) {
  console.error(`error: ${err.message || err}`);
  process.exit(1);
}
