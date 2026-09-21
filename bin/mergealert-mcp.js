#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as watcher from '../src/watcher.js';

const server = new McpServer({
  name: 'mergealert',
  version: '0.1.0',
});

// ── Tools ───────────────────────────────────────────────────────────────────

server.registerTool(
  'add_watch',
  {
    title: 'Add Watch',
    description: 'Add a branch watch. Clones the repo (if needed) and immediately checks merge status.',
    inputSchema: z.object({
      url: z.string().describe('Git repository URL (HTTPS or SSH)'),
      branch: z.string().describe('Branch name to watch'),
      target: z.string().optional().describe('Target branch to check merge into (defaults to repo default branch)'),
    }),
  },
  async ({ url, branch, target }) => {
    try {
      const watch = await watcher.addWatch({ url, branch, target });
      const checked = await watcher.checkOne(watch.id);
      return { content: [{ type: 'text', text: JSON.stringify(checked || watch, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.registerTool(
  'remove_watch',
  {
    title: 'Remove Watch',
    description: 'Remove a branch watch by its ID.',
    inputSchema: z.object({
      id: z.string().describe('Watch ID to remove'),
    }),
  },
  async ({ id }) => {
    const removed = watcher.removeWatch(id);
    return {
      content: [{ type: 'text', text: removed ? `Watch ${id} removed.` : `No watch found with ID ${id}.` }],
    };
  },
);

server.registerTool(
  'list_watches',
  {
    title: 'List Watches',
    description: 'List all current branch watches with their statuses.',
  },
  async () => {
    const watches = watcher.getWatches();
    if (!watches.length) {
      return { content: [{ type: 'text', text: 'No watches configured.' }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(watches, null, 2) }] };
  },
);

server.registerTool(
  'check_watch',
  {
    title: 'Check Watch',
    description: 'Check a single watch by ID — fetches from remote and returns current merge status.',
    inputSchema: z.object({
      id: z.string().describe('Watch ID to check'),
    }),
  },
  async ({ id }) => {
    try {
      const result = await watcher.checkOne(id);
      if (!result) {
        return { content: [{ type: 'text', text: `No watch found with ID ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.registerTool(
  'check_all',
  {
    title: 'Check All Watches',
    description: 'Check all watches — fetches from all remotes and returns updated statuses.',
  },
  async () => {
    try {
      const watches = await watcher.checkAll();
      if (!watches.length) {
        return { content: [{ type: 'text', text: 'No watches to check.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(watches, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.registerTool(
  'list_branches',
  {
    title: 'List Branches',
    description: 'List remote branches for a repository. Clones the repo if not already cached.',
    inputSchema: z.object({
      url: z.string().describe('Git repository URL'),
    }),
  },
  async ({ url }) => {
    try {
      const result = await watcher.branchesFor(url);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
