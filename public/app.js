const $ = (sel) => document.querySelector(sel);
const seen = new Map(); // watch id -> last status, so we alert only on change

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function ago(iso) {
  if (!iso) return 'never';
  // Clamped: a check that just landed can read as fractionally in the future.
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function repoName(url) {
  return url.replace(/\.git$/, '').split('/').slice(-2).join('/');
}

const LANDED = new Set(['merged', 'gone']);
const openGroups = new Map(); // group key -> expanded, so a re-render keeps your sections open
let currentGroups = [];

// One section per watched branch; the cards inside are the branches it should land in.
function groupBy(watches) {
  const groups = new Map();
  for (const w of watches) {
    const key = `${w.url}|${w.branch}`;
    if (!groups.has(key)) groups.set(key, { key, url: w.url, branch: w.branch, items: [] });
    groups.get(key).items.push(w);
  }
  for (const group of groups.values()) {
    group.landed = group.items.filter((w) => LANDED.has(w.status)).length;
    group.status = groupStatus(group.items);
    group.items.sort((a, b) => a.target.localeCompare(b.target));
  }
  // `pending` ranks with `open`: a section must not jump around while a freshly
  // added card is still being checked, only when its real status changes.
  const rank = { error: 0, open: 1, pending: 1, merged: 2 };
  return [...groups.values()].sort(
    (a, b) => rank[a.status] - rank[b.status] || a.branch.localeCompare(b.branch),
  );
}

function groupStatus(items) {
  if (items.every((w) => LANDED.has(w.status))) return 'merged';
  if (items.some((w) => w.status === 'error')) return 'error';
  if (items.some((w) => w.status === 'pending')) return 'pending';
  return 'open';
}

function groupLabel(group) {
  const total = group.items.length;
  if (group.status === 'merged') return total > 1 ? `all ${total} merged` : 'merged';
  if (group.status === 'error') return 'error';
  return `${group.landed}/${total} merged`;
}

function watchCard(w) {
  const el = document.createElement('div');
  el.className = `watch ${w.status}`;
  el.innerHTML = `
    <div class="body">
      <div class="title">
        <span class="badge ${w.status}">${w.status}</span>
        into <code>${w.target}</code>
      </div>
      <div class="detail"></div>
      <div class="shared" hidden></div>
      <div class="meta"></div>
    </div>
    <div class="actions">
      <button class="link check">check</button>
      <button class="link remove">remove</button>
    </div>`;
  el.querySelector('.detail').textContent = w.detail || '';
  el.querySelector('.meta').textContent = `checked ${ago(w.lastChecked)}`;

  // For a branch that hasn't fully landed, show how far into the target it got.
  const shared = el.querySelector('.shared');
  if (w.lastShared) {
    const { sha, subject, date, relative, author } = w.lastShared;
    shared.hidden = false;
    shared.title = `${author} - ${new Date(date).toLocaleString()}`;
    shared.textContent = `last shared with ${w.target}: ${sha} ${subject} - ${formatDate(date)} (${relative})`;
  }
  el.querySelector('.check').onclick = async () => {
    await api(`/api/watches/${w.id}/check`, { method: 'POST' });
    refresh();
  };
  el.querySelector('.remove').onclick = async () => {
    await api(`/api/watches/${w.id}`, { method: 'DELETE' });
    refresh();
  };
  return el;
}

function groupSection(group) {
  const el = document.createElement('details');
  el.className = `group ${group.status}`;
  // Finished branches start collapsed - they need no attention.
  el.open = isOpen(group);
  el.ontoggle = () => {
    openGroups.set(group.key, el.open);
    syncToggleAll();
  };

  const summary = document.createElement('summary');
  summary.innerHTML = `
    <span class="chev" aria-hidden="true">▸</span>
    <span class="group-title"><code></code></span>
    <span class="badge ${group.status}"></span>
    <span class="group-meta"></span>`;
  summary.querySelector('code').textContent = group.branch;
  summary.querySelector('.badge').textContent = groupLabel(group);
  summary.querySelector('.group-meta').textContent = repoName(group.url);
  el.append(summary, ...group.items.map(watchCard));
  return el;
}

function isOpen(group) {
  return openGroups.get(group.key) ?? group.status !== 'merged';
}

function syncToggleAll() {
  const button = $('#toggle-all');
  const removeAll = $('#remove-all');
  button.hidden = !currentGroups.length;
  removeAll.hidden = !currentGroups.length;
  button.textContent = currentGroups.every(isOpen) ? 'Collapse all' : 'Expand all';
}

function render(watches) {
  $('#count').textContent = watches.length ? `(${watches.length})` : '';
  const host = $('#watches');
  host.replaceChildren();
  currentGroups = watches.length ? groupBy(watches) : [];

  if (!watches.length) {
    host.innerHTML = '<p class="empty">Nothing watched yet. Add a repo above.</p>';
  } else {
    host.append(...currentGroups.map(groupSection));
  }
  syncToggleAll();
}

function browserAlert(watch) {
  if (Notification?.permission !== 'granted') return;
  const verb = watch.status === 'merged' ? 'merged into' : 'gone from';
  new Notification(`${watch.branch} ${verb} ${watch.target}`, { body: watch.detail || '' });
}

async function refresh() {
  try {
    const { watches, intervalMs } = await api('/api/state');
    for (const w of watches) {
      const previous = seen.get(w.id);
      if (previous && previous !== w.status && (w.status === 'merged' || w.status === 'gone')) {
        browserAlert(w);
      }
      seen.set(w.id, w.status);
    }
    render(watches);
    if (document.activeElement !== $('#interval')) $('#interval').value = intervalMs / 1000;
  } catch (err) {
    console.error(err);
  }
}

function message(text, isError = false) {
  const el = $('#form-msg');
  el.textContent = text;
  el.className = isError ? 'msg error' : 'msg';
}

$('#add-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message('cloning / checking…');
  try {
    await api('/api/watches', {
      method: 'POST',
      body: {
        url: $('#url').value.trim(),
        branch: $('#branch').value.trim(),
        target: $('#target').value.trim() || undefined,
      },
    });
    message('watch added');
    $('#branch').value = '';
    refresh();
  } catch (err) {
    message(err.message, true);
  } finally {
    button.disabled = false;
  }
};

$('#load-branches').onclick = async () => {
  const url = $('#url').value.trim();
  if (!url) return message('enter a repository URL first', true);
  message('fetching branches…');
  try {
    const { branches, default: def } = await api(`/api/branches?url=${encodeURIComponent(url)}`);
    $('#branches').replaceChildren(
      ...branches.map((b) => Object.assign(document.createElement('option'), { value: b })),
    );
    $('#target').placeholder = `${def} (default)`;
    message(`${branches.length} branches loaded`);
  } catch (err) {
    message(err.message, true);
  }
};

$('#toggle-all').onclick = () => {
  const expand = !currentGroups.every(isOpen);
  for (const group of currentGroups) openGroups.set(group.key, expand);
  for (const el of document.querySelectorAll('.group')) el.open = expand;
  syncToggleAll();
};

$('#check-all').onclick = async (event) => {
  event.target.disabled = true;
  try {
    await api('/api/check', { method: 'POST' });
    refresh();
  } finally {
    event.target.disabled = false;
  }
};

$('#remove-all').onclick = async (event) => {
  if (!confirm('Remove all watches?')) return;
  event.target.disabled = true;
  try {
    await api('/api/watches', { method: 'DELETE' });
    seen.clear();
    refresh();
  } finally {
    event.target.disabled = false;
  }
};

$('#interval').onchange = async (event) => {
  await api('/api/settings', { method: 'POST', body: { intervalMs: Number(event.target.value) * 1000 } });
  refresh();
};

$('#enable-notifications').onclick = async () => {
  const permission = await Notification.requestPermission();
  message(permission === 'granted' ? 'browser alerts on' : 'browser alerts blocked', permission !== 'granted');
};

refresh();
setInterval(refresh, 5000);
