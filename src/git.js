import { execFile } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import { repoPath } from './store.js';

const exec = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0', // never hang waiting for credentials
  GIT_ASKPASS: 'echo',
};

async function git(cwd, args, timeout = 120_000) {
  const { stdout } = await exec('git', args, { cwd, env: GIT_ENV, timeout, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function gitOk(cwd, args) {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/** Bare-clone the repo into ~/.mergealert/repos if we don't have it yet. */
export async function ensureClone(url) {
  const dir = repoPath(url);
  if (existsSync(dir)) return dir;
  try {
    await git(process.cwd(), ['clone', '--bare', '--quiet', url, dir], 300_000);
    await git(dir, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*']);
  } catch (err) {
    // Don't leave a half-written clone behind for the next run to trip over.
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return dir;
}

/** Pull down the latest refs, dropping branches that no longer exist upstream. */
export async function fetch(url) {
  const dir = await ensureClone(url);
  await git(dir, ['fetch', '--quiet', '--prune', '--force', 'origin']);
  return dir;
}

export async function listBranches(url) {
  const dir = await ensureClone(url);
  const out = await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out ? out.split('\n') : [];
}

export async function defaultBranch(url) {
  const dir = await ensureClone(url);
  try {
    const out = await git(dir, ['symbolic-ref', '--short', 'HEAD']);
    if (out) return out;
  } catch { /* fall through */ }
  const branches = await listBranches(url);
  return branches.find((b) => b === 'main' || b === 'master') || branches[0] || 'main';
}

/**
 * Work out whether `branch` has landed in `target`.
 * Statuses: merged | open | gone | error
 * `gone` means the branch vanished upstream - the usual sign of a squash/rebase
 * merge followed by a branch delete, which no ancestry check can detect.
 */

/**
 * The newest commit of `branch` that `target` already has - the merge base.
 * For a partially merged branch that is the last piece of work that landed;
 * for one that has never been merged it is the commit it forked from.
 */
async function lastSharedCommit(dir, branch, target) {
  try {
    const base = await git(dir, ['merge-base', `refs/heads/${branch}`, `refs/heads/${target}`]);
    const line = await git(dir, ['log', '-1', '--format=%h%x1f%s%x1f%aI%x1f%ar%x1f%an', base]);
    const [sha, subject, date, relative, author] = line.split('\x1f');
    return { sha, subject, date, relative, author };
  } catch {
    return null;
  }
}

export async function checkMerged(url, branch, target) {
  const dir = await fetch(url);

  const hasTarget = await gitOk(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${target}`]);
  if (!hasTarget) return { status: 'error', detail: `target branch "${target}" not found` };

  const hasBranch = await gitOk(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (!hasBranch) {
    return { status: 'gone', detail: `branch "${branch}" no longer exists upstream (deleted, likely squash-merged)` };
  }

  const merged = await gitOk(dir, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/heads/${target}`]);
  if (!merged) {
    const behind = await git(dir, ['rev-list', '--count', `refs/heads/${target}..refs/heads/${branch}`]);
    return {
      status: 'open',
      detail: `${behind} commit(s) not yet in ${target}`,
      lastShared: await lastSharedCommit(dir, branch, target),
    };
  }

  // Oldest commit on the path from branch into target - i.e. where it landed.
  const path = await git(dir, ['rev-list', '--ancestry-path', `refs/heads/${branch}..refs/heads/${target}`]);
  const landedSha = path ? path.split('\n').pop() : await git(dir, ['rev-parse', `refs/heads/${branch}`]);
  const detail = await git(dir, ['log', '-1', '--format=%h %s (%an, %ar)', landedSha]);
  return { status: 'merged', detail };
}
