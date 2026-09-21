# MergeAlert

Watch git branches and get a desktop notification the moment they land in another branch.

MergeAlert keeps its own bare clones under `~/.mergealert`, so it never touches your working
copies. It polls the remotes on a timer, and when a watched branch becomes an ancestor of its
target — or disappears upstream, the usual sign of a squash-merge — it fires a notification and
flips the status in the web UI.

Zero runtime dependencies. Node 18+ and `git` are all it needs.

## Install

```bash
npm install -g mergealert
```

## Use

```bash
mergealert                 # start the web UI + watcher at http://127.0.0.1:4321
mergealert --open          # ...and open a browser
mergealert --port 5000 --host 0.0.0.0
```

Terminal-only workflow, if you prefer:

```bash
mergealert add https://github.com/owner/repo.git feature/my-work main
mergealert add git@github.com:owner/repo.git feature/my-work   # target defaults to the repo's HEAD
mergealert list
mergealert check           # check everything once, then exit
mergealert rm <id>
```

## Statuses

| Status    | Meaning |
|-----------|---------|
| `merged`  | The branch is an ancestor of the target. Shows the commit it landed in. |
| `gone`    | The branch no longer exists upstream — squash/rebase merged and deleted. |
| `open`    | Not merged yet. Shows how many commits are still outstanding, plus the last commit the branch shares with the target. |
| `pending` | Added, first check hasn't finished. |
| `error`   | Fetch failed, or the target branch doesn't exist. |

### Partially merged branches

An `open` watch also reports the newest commit the branch and its target have in common — the
merge base — with its short SHA, subject and date:

```
open    feature/parser -> main
        1 commit(s) not yet in main
        last shared with main: 5c28a30 add validation (2026-08-20, 3 weeks ago)
```

If some of the branch's work has already landed, that's the last piece that made it in. If none of
it has, it's the commit the branch was cut from — git's history alone can't tell those two apart, so
the wording stays neutral either way.

## Notifications

Each watch notifies once, on the transition into `merged` or `gone`. MergeAlert tries, in order:

1. `notify-send` (libnotify — standard on Linux desktops)
2. `wsl-notify-send.exe` (WSL)
3. A PowerShell toast (WSL fallback)
4. The terminal, if none of the above are available

The web UI can also raise browser notifications while it's open — click **Browser alerts** to grant
permission.

## MCP Server

MergeAlert ships an MCP (Model Context Protocol) server so AI agents can manage
watches on demand — no polling, no background watcher.

### Hermes Agent

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  mergealert:
    command: node
    args:
      - /absolute/path/to/MergeAlert/bin/mergealert-mcp.js
```

If installed globally (`npm install -g mergealert`), use the binary name directly:

```yaml
mcp_servers:
  mergealert:
    command: mergealert-mcp
```

Restart Hermes after editing the config. The following tools become available:

| Tool              | Description                                              |
|-------------------|----------------------------------------------------------|
| `add_watch`       | Add a branch watch and immediately check its status      |
| `remove_watch`    | Remove a watch by ID                                     |
| `list_watches`    | List all watches with current statuses                   |
| `check_watch`     | Fetch from remote and check one watch                    |
| `check_all`       | Fetch all remotes and check every watch                  |
| `list_branches`   | List remote branches for a repository                    |

## Config

Everything lives in `~/.mergealert`:

```
~/.mergealert/
  config.json     # watches + poll interval
  repos/          # bare clones, one per repository
```

Set `MERGEALERT_HOME` to move that directory, `MERGEALERT_PORT` to change the default port.

Private repos work through whatever git credentials you already have (SSH keys, credential helper).
MergeAlert never prompts for credentials — it sets `GIT_TERMINAL_PROMPT=0` so a repo it can't reach
surfaces as an `error` status instead of hanging.

## License

MIT
