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
const showLanded = new Map(); // target -> landed list expanded, so a re-render keeps it
let currentColumns = [];

// One column per target branch name - watches from different repos that
// target the same name (e.g. `main`) share a column.
function columnsFor(watches) {
  const columns = new Map();
  for (const w of watches) {
    if (!columns.has(w.target)) columns.set(w.target, { target: w.target, items: [] });
    columns.get(w.target).items.push(w);
  }
  // `pending` ranks with `open` so a freshly added card doesn't jump once checked.
  const rank = { error: 0, open: 1, pending: 1 };
  for (const col of columns.values()) {
    col.active = col.items
      .filter((w) => !LANDED.has(w.status))
      .sort((a, b) => rank[a.status] - rank[b.status] || a.branch.localeCompare(b.branch));
    col.landed = col.items
      .filter((w) => LANDED.has(w.status))
      .sort((a, b) => a.branch.localeCompare(b.branch));
    col.repos = new Set(col.items.map((w) => repoName(w.url))).size;
  }
  // Busiest columns first; a column with nothing left to wait on goes last.
  return [...columns.values()].sort(
    (a, b) =>
      (b.active.length > 0) - (a.active.length > 0) ||
      b.items.length - a.items.length ||
      a.target.localeCompare(b.target),
  );
}

function watchCard(w) {
  const el = document.createElement('article');
  el.className = `watch ${w.status}`;
  el.innerHTML = `
    <div class="title">
      <code class="branch"></code>
      <span class="badge ${w.status}">${w.status}</span>
    </div>
    <div class="repo"></div>
    <div class="detail"></div>
    <div class="shared" hidden></div>
    <div class="foot">
      <span class="meta"></span>
      <span class="actions">
        <button class="link check">check</button>
        <button class="link remove">remove</button>
      </span>
    </div>`;
  el.querySelector('.branch').textContent = w.branch;
  el.querySelector('.branch').title = w.branch;
  el.querySelector('.repo').textContent = repoName(w.url);
  el.querySelector('.repo').title = w.url;
  el.querySelector('.detail').textContent = w.detail || '';
  el.querySelector('.meta').textContent = `checked ${ago(w.lastChecked)}`;

  // For a branch that hasn't fully landed, show how far into the target it got.
  const shared = el.querySelector('.shared');
  if (w.lastShared) {
    const { sha, subject, date, relative, author } = w.lastShared;
    shared.hidden = false;
    shared.title = `${author} - ${new Date(date).toLocaleString()}`;
    shared.innerHTML = '<span class="label">last shared</span> <code></code> <span class="subject"></span> <span class="when"></span>';
    shared.querySelector('code').textContent = sha;
    shared.querySelector('.subject').textContent = subject;
    shared.querySelector('.when').textContent = `${formatDate(date)} (${relative})`;
  }
  el.querySelector('.check').onclick = async (event) => {
    event.target.disabled = true;
    await api(`/api/watches/${w.id}/check`, { method: 'POST' });
    refresh();
  };
  el.querySelector('.remove').onclick = async () => {
    await api(`/api/watches/${w.id}`, { method: 'DELETE' });
    refresh();
  };
  return el;
}

function column(col) {
  const el = document.createElement('div');
  el.className = `column${col.active.length ? '' : ' done'}`;

  const head = document.createElement('div');
  head.className = 'column-head';
  head.innerHTML = `
    <span class="arrow" aria-hidden="true">⤵</span>
    <code class="target"></code>
    <span class="tally"></span>`;
  head.querySelector('.target').textContent = col.target;
  head.querySelector('.target').title = col.target;
  head.querySelector('.tally').textContent = `${col.landed.length}/${col.items.length} merged`;
  if (col.repos > 1) head.title = `${col.repos} repositories`;

  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.innerHTML = '<span></span>';
  progress.firstChild.style.width = `${(col.landed.length / col.items.length) * 100}%`;

  const body = document.createElement('div');
  body.className = 'column-body';
  body.append(...col.active.map(watchCard));
  if (!col.active.length) {
    body.insertAdjacentHTML('beforeend', '<p class="all-done">Everything landed ✓</p>');
  }

  if (col.landed.length) {
    const landed = document.createElement('details');
    landed.className = 'landed';
    landed.open = isOpen(col);
    landed.ontoggle = () => {
      showLanded.set(col.target, landed.open);
      syncToggleAll();
    };
    const summary = document.createElement('summary');
    summary.innerHTML = '<span class="chev" aria-hidden="true"></span> landed <span class="badge merged"></span>';
    summary.querySelector('.badge').textContent = col.landed.length;
    landed.append(summary, ...col.landed.map(watchCard));
    body.append(landed);
  }

  el.append(head, progress, body);
  return el;
}

function isOpen(col) {
  return showLanded.get(col.target) ?? false;
}

function syncToggleAll() {
  const withLanded = currentColumns.filter((c) => c.landed.length);
  const button = $('#toggle-all');
  button.hidden = !withLanded.length;
  $('#remove-all').hidden = !currentColumns.length;
  button.textContent = withLanded.length && withLanded.every(isOpen) ? 'Hide landed' : 'Show landed';
}

function render(watches) {
  currentColumns = columnsFor(watches);
  const n = currentColumns.length;
  $('#count').textContent = watches.length
    ? `(${n} ${n === 1 ? 'target' : 'targets'}, ${watches.length} ${watches.length === 1 ? 'watch' : 'watches'})`
    : '';
  const host = $('#board');
  if (!watches.length) {
    host.innerHTML = '<p class="empty">Nothing watched yet. Add a repo above.</p>';
  } else {
    // Keep the board's horizontal scroll position across the 5s refresh.
    const scroll = host.scrollLeft;
    host.replaceChildren(...currentColumns.map(column));
    host.scrollLeft = scroll;
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
  const withLanded = currentColumns.filter((c) => c.landed.length);
  const expand = !withLanded.every(isOpen);
  for (const col of withLanded) showLanded.set(col.target, expand);
  for (const el of document.querySelectorAll('.landed')) el.open = expand;
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
