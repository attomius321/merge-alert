#!/usr/bin/env node
/**
 * Integration tests for the MergeAlert MCP server.
 * Spawns the server as a child process, talks JSON-RPC over stdio.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { ROOT } from '../src/store.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const SERVER = join(DIR, '..', 'bin', 'mergealert-mcp.js');
const TEST_REPO = 'https://github.com/attomius321/merge-alert.git';

let child;
let buffer = '';
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }
let passed = 0;
let failed = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

function startServer() {
  child = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MERGEALERT_HOME: join(ROOT, '..', '.mergealert-test'),
    },
  });

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          const { resolve, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch { /* ignore non-JSON lines */ }
    }
  });

  child.stderr.on('data', () => {}); // swallow stderr
}

function send(method, params = {}, timeoutMs = 120_000) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for response to ${method} (id=${id})`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify(msg) + '\n');
  });
}

function callTool(name, args = {}, timeoutMs = 120_000) {
  return send('tools/call', { name, arguments: args }, timeoutMs);
}

function toolText(response) {
  return response.result?.content?.[0]?.text ?? '';
}

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

function cleanup() {
  const testHome = join(ROOT, '..', '.mergealert-test');
  try { rmSync(testHome, { recursive: true, force: true }); } catch { /* ok */ }
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function run() {
  cleanup();
  startServer();

  try {
    // 1. Initialize
    console.log('\n— initialize');
    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.1.0' },
    });
    assert(init.result?.serverInfo?.name === 'mergealert', 'server name is mergealert');
    assert(init.result?.protocolVersion === '2024-11-05', 'protocol version matches');

    // 2. List tools
    console.log('\n— tools/list');
    const tools = await send('tools/list');
    const names = tools.result.tools.map((t) => t.name).sort();
    const expected = ['add_watch', 'check_all', 'check_watch', 'list_branches', 'list_watches', 'remove_all_watches', 'remove_watch'];
    assert(JSON.stringify(names) === JSON.stringify(expected), `7 tools registered: ${names.join(', ')}`);

    // 3. list_watches (empty)
    console.log('\n— list_watches (empty)');
    const empty = await callTool('list_watches');
    assert(toolText(empty).includes('No watches configured'), 'no watches on fresh state');

    // 4. list_branches
    console.log('\n— list_branches');
    const branches = await callTool('list_branches', { url: TEST_REPO });
    const brData = JSON.parse(toolText(branches));
    assert(Array.isArray(brData.branches), 'branches is an array');
    assert(brData.branches.includes('main'), 'main branch present');
    assert(typeof brData.default === 'string', 'default branch returned');

    // 5. add_watch
    console.log('\n— add_watch');
    const added = await callTool('add_watch', { url: TEST_REPO, branch: 'main', target: 'main' });
    const watch = JSON.parse(toolText(added));
    assert(typeof watch.id === 'string' && watch.id.length > 0, 'watch has an id');
    assert(watch.branch === 'main', 'branch is main');
    assert(watch.target === 'main', 'target is main');
    assert(['merged', 'open', 'gone', 'error', 'pending'].includes(watch.status), `status is valid: ${watch.status}`);

    const watchId = watch.id;

    // 6. list_watches (has one)
    console.log('\n— list_watches (after add)');
    const listed = await callTool('list_watches');
    const watches = JSON.parse(toolText(listed));
    assert(Array.isArray(watches) && watches.length === 1, 'one watch listed');
    assert(watches[0].id === watchId, 'listed watch id matches');

    // 7. check_watch
    console.log('\n— check_watch');
    const checked = await callTool('check_watch', { id: watchId });
    const checkedWatch = JSON.parse(toolText(checked));
    assert(checkedWatch.id === watchId, 'checked watch id matches');
    assert(checkedWatch.lastChecked !== null, 'lastChecked is set');

    // 8. check_all
    console.log('\n— check_all');
    const all = await callTool('check_all');
    const allWatches = JSON.parse(toolText(all));
    assert(Array.isArray(allWatches) && allWatches.length === 1, 'check_all returns 1 watch');

    // 9. remove_all_watches (with watches)
    console.log('\n— remove_all_watches');
    const removedAll = await callTool('remove_all_watches');
    assert(toolText(removedAll).includes('Removed all 1 watch(es)'), 'remove_all removed 1 watch');

    // 10. list_watches (empty after remove all)
    console.log('\n— list_watches (after remove all)');
    const emptyAfterAll = await callTool('list_watches');
    assert(toolText(emptyAfterAll).includes('No watches configured'), 'no watches after remove all');

    // 11. remove_all_watches (already empty)
    console.log('\n— remove_all_watches (empty)');
    const removedNone = await callTool('remove_all_watches');
    assert(toolText(removedNone).includes('No watches to remove'), 'remove_all on empty returns no watches');

    // 12. remove_watch (bogus id)
    console.log('\n— remove_watch (bogus)');
    const bogus = await callTool('remove_watch', { id: 'no-such-id' });
    assert(toolText(bogus).includes('No watch found'), 'bogus id returns not found');

  } finally {
    child.kill();
    cleanup();
  }

  // Summary
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  child?.kill();
  cleanup();
  process.exit(1);
});
