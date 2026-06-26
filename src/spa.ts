import { readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SPA_ROUTES = new Set(["/", "/index.html", "/sessions"]);

function isSpaRoute(pathname: string): boolean {
  return SPA_ROUTES.has(pathname) || pathname.startsWith("/sessions/");
}

/**
 * Creates a SPA request handler.
 * If staticDir is provided, serves files from that directory.
 * Otherwise, returns the built-in default SPA.
 */
export function createSpaHandler(staticDir: string | undefined): (url: URL) => Response | null {
  if (staticDir) {
    return (url: URL) => handleStaticDir(url, staticDir);
  }
  return (url: URL) => handleBuiltinSpa(url);
}

function handleStaticDir(url: URL, staticDir: string): Response | null {
  const pathname = url.pathname;

  if (isSpaRoute(pathname)) {
    return serveFile(join(staticDir, "index.html"));
  }

  const filePath = join(staticDir, pathname);
  if (!filePath.startsWith(staticDir + "/")) {
    return null;
  }

  try {
    const s = statSync(filePath);
    if (s.isFile()) {
      return serveFile(filePath);
    }
  } catch {
    // fall through
  }

  return null;
}

function serveFile(filePath: string): Response | null {
  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  } catch {
    return null;
  }
}

function handleBuiltinSpa(url: URL): Response | null {
  if (!isSpaRoute(url.pathname)) return null;
  return new Response(BUILTIN_INDEX_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const BUILTIN_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>prepalert-agent</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#0e1014;--panel:#15181f;--panel-2:#1b1f28;--panel-3:#232838;
  --border:#262b36;--border-2:#343b49;
  --text:#e6e9ef;--text-dim:#9aa3b2;--text-faint:#646c7a;
  --accent:#a585ff;--accent-soft:#241d3a;
  --blue:#4d8dff;--green:#34d27b;--red:#ff5c5c;
  --blue-soft:#13233f;--green-soft:#0f2a1e;--red-soft:#331417;
  --code-bg:#0a0c10;
}
[data-theme="light"]{
  --bg:#f4f5f8;--panel:#ffffff;--panel-2:#f7f8fa;--panel-3:#eceef2;
  --border:#e4e7ec;--border-2:#d2d7df;
  --text:#1b1e26;--text-dim:#545a6b;--text-faint:#9296a6;
  --accent:#7c3aed;--accent-soft:#f1ebff;
  --blue:#2563eb;--green:#16a34a;--red:#dc2626;
  --blue-soft:#e8f0ff;--green-soft:#e7f7ee;--red-soft:#fdeaea;
  --code-bg:#f4f5f8;
}
html,body{height:100%;font-family:'Noto Sans JP',system-ui,sans-serif;font-size:13px;background:var(--bg);color:var(--text);}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.25;}}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes toastin{from{opacity:0;transform:translate(-50%,12px);}to{opacity:1;transform:translate(-50%,0);}}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:6px;border:2px solid var(--bg);}
::-webkit-scrollbar-track{background:transparent;}
a{color:var(--accent);text-decoration:none;}
code{font-family:'Roboto Mono',monospace;font-size:12px;background:var(--code-bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--accent);}
pre{margin:14px 0;padding:13px 15px;background:var(--code-bg);border:1px solid var(--border);border-radius:8px;overflow:auto;font:12px/1.6 'Roboto Mono',monospace;color:var(--text-dim);}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;}
th{text-align:left;padding:8px 12px;border-bottom:2px solid var(--border-2);color:var(--text-dim);font:600 12px system-ui;background:var(--panel-2);}
td{padding:7px 12px;border-bottom:1px solid var(--border);color:var(--text-dim);}

.layout{height:100vh;display:flex;flex-direction:column;overflow:hidden;}
.header{height:50px;flex:none;display:flex;align-items:center;gap:14px;padding:0 18px;border-bottom:1px solid var(--border);background:var(--panel);}
.header-title{font:700 18px system-ui;color:var(--text);}
.header-badge{font:600 9px system-ui;letter-spacing:.18em;color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:1px 5px;}
.header-sub{font:11px monospace;color:var(--text-faint);padding-top:2px;}
.body{flex:1;display:flex;min-height:0;}

.sidebar{width:336px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--panel);min-height:0;}
.sidebar-head{padding:13px 15px 11px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--border);}
.sidebar-title{font:700 12px system-ui;letter-spacing:.07em;text-transform:uppercase;color:var(--text-dim);}
.sidebar-count{font:500 11px monospace;color:var(--text-faint);background:var(--panel-3);border-radius:10px;padding:1px 8px;}
.search{width:100%;height:30px;border:1px solid var(--border-2);background:var(--bg);border-radius:6px;padding:0 10px;color:var(--text);font:13px system-ui;outline:none;}
.chips{display:flex;gap:5px;}
.chip{display:inline-flex;align-items:center;height:25px;padding:0 9px;border-radius:13px;cursor:pointer;font:500 11px system-ui;border:1px solid var(--border-2);background:transparent;color:var(--text-dim);}
.chip.active{border-color:var(--accent);background:var(--accent-soft);color:var(--accent);}
.chip-count{opacity:.55;margin-left:5px;font-family:monospace;}
.session-list{flex:1;overflow:auto;min-height:0;}
.session-row{padding:9px 15px;border-bottom:1px solid var(--border);cursor:pointer;border-left:3px solid transparent;}
.session-row.active{border-left-color:var(--accent);background:var(--panel-2);}
.session-row:hover{background:var(--panel-2);}

.main{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--bg);}
.detail-head{flex:none;padding:14px 22px 0;border-bottom:1px solid var(--border);background:var(--panel);}
.detail-meta{display:flex;align-items:center;gap:18px;margin:11px 0 0;font:12px system-ui;color:var(--text-faint);}
.tabs{display:flex;gap:2px;margin-top:13px;}
.tab{position:relative;height:34px;padding:0 13px;border:none;background:transparent;cursor:pointer;font:500 13px system-ui;color:var(--text-dim);border-bottom:2px solid transparent;margin-bottom:-1px;}
.tab.active{font-weight:600;color:var(--text);border-bottom-color:var(--accent);}
.tab-count{margin-left:7px;font:500 10px monospace;border-radius:9px;padding:1px 6px;background:var(--panel-3);color:var(--text-faint);}
.tab.active .tab-count{background:var(--accent-soft);color:var(--accent);}
.content{flex:1;overflow:auto;min-height:0;padding:22px;}
.content-inner{max-width:860px;margin:0 auto;}

.badge{display:inline-flex;align-items:center;gap:5px;font:600 10px system-ui;letter-spacing:.05em;border-radius:5px;padding:2px 7px;}
.badge-lg{font-size:11px;padding:4px 9px;}
.badge-dot{width:6px;height:6px;border-radius:50%;}
.status-running{color:var(--blue);background:var(--blue-soft);border:1px solid color-mix(in srgb,var(--blue) 25%,transparent);}
.status-running .badge-dot{background:var(--blue);animation:pulse 1.3s ease infinite;}
.status-completed{color:var(--green);background:var(--green-soft);border:1px solid color-mix(in srgb,var(--green) 25%,transparent);}
.status-completed .badge-dot{background:var(--green);}
.status-error{color:var(--red);background:var(--red-soft);border:1px solid color-mix(in srgb,var(--red) 25%,transparent);}
.status-error .badge-dot{background:var(--red);}

.btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border:1px solid var(--border-2);background:var(--panel-2);color:var(--text-dim);border-radius:6px;cursor:pointer;font:500 12px system-ui;}
.btn-primary{border:none;background:var(--accent);color:#fff;font-weight:600;}
.btn-icon{width:30px;height:30px;padding:0;justify-content:center;font-size:14px;}

.runbook-card{border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:hidden;margin-bottom:10px;}
.runbook-header{display:flex;align-items:center;gap:11px;padding:13px 16px;cursor:pointer;}
.runbook-body{border-top:1px solid var(--border);padding:6px 22px 16px;}

.artifact-card{border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:hidden;margin-bottom:14px;}
.artifact-header{display:flex;align-items:center;gap:10px;padding:11px 15px;border-bottom:1px solid var(--border);background:var(--panel-2);}
.artifact-ext{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;padding:0 6px;border-radius:4px;font:600 9px monospace;letter-spacing:.05em;}

.transcript-entry{border:1px solid var(--border);border-radius:7px;padding:11px 14px;background:var(--panel);margin-bottom:7px;}
.transcript-tag{font:600 10px system-ui;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:4px;}

.modal-bg{position:fixed;inset:0;background:rgba(6,8,12,.62);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:50;}
.modal{width:560px;max-width:calc(100vw - 40px);max-height:calc(100vh - 60px);overflow:auto;background:var(--panel);border:1px solid var(--border-2);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);}

.toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);font:500 13px system-ui;padding:10px 18px;border-radius:8px;z-index:60;animation:toastin .25s ease;}

.empty{padding:34px 20px;text-align:center;color:var(--text-faint);font-size:12px;}
.loading{display:flex;align-items:center;gap:12px;padding:18px 20px;border:1px dashed var(--border-2);border-radius:8px;background:var(--blue-soft);color:var(--blue);margin-bottom:20px;}
.spinner{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite;}

.handoff-target{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;padding:13px 14px;border-radius:9px;cursor:pointer;border:1.5px solid var(--border-2);background:var(--panel-2);color:var(--text);}
.handoff-target.active{border-color:var(--accent);background:var(--accent-soft);}
</style>
</head>
<body>
<div id="app" data-theme="dark" class="layout">
  <div class="header">
    <div style="display:flex;align-items:baseline;gap:8px;">
      <span class="header-title">prepalert</span>
      <span class="header-badge">AGENT</span>
    </div>
    <span class="header-sub">session viewer</span>
    <div style="flex:1;"></div>
    <button class="btn btn-icon" id="theme-toggle" title="Toggle theme"></button>
  </div>

  <div class="body">
    <div class="sidebar">
      <div class="sidebar-head">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="sidebar-title">Sessions</span>
          <span class="sidebar-count" id="total-count">0</span>
        </div>
        <input class="search" id="search-input" placeholder="Search sessions..." />
        <div class="chips" id="filter-chips"></div>
      </div>
      <div class="session-list" id="session-list"></div>
    </div>

    <div class="main">
      <div class="detail-head" id="detail-head"></div>
      <div class="content"><div class="content-inner" id="content-area"></div></div>
    </div>
  </div>
  <div class="modal-bg" id="handoff-modal" style="display:none;"></div>
  <div class="toast" id="toast" style="display:none;"></div>
</div>

<script>
(function(){
  const API = '/api';
  let sessions = [];
  let selected = null;
  let filter = 'all';
  let query = '';
  let tab = 'report';
  let theme = localStorage.getItem('pa-theme') || 'dark';
  let cursor = null;
  let hasMore = false;

  const $ = id => document.getElementById(id);
  const app = $('app');
  app.dataset.theme = theme;

  const pathMatch = location.pathname.match(/^\\/sessions\\/(.+)/);
  if (pathMatch) selected = decodeURIComponent(pathMatch[1]);

  function updateThemeButton() {
    $('theme-toggle').textContent = theme === 'dark' ? '\\u2600' : '\\u263E';
  }
  $('theme-toggle').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    app.dataset.theme = theme;
    localStorage.setItem('pa-theme', theme);
    updateThemeButton();
  };
  updateThemeButton();

  async function fetchSessions(append) {
    const params = new URLSearchParams({ limit: '50' });
    if (append && cursor) params.set('cursor', cursor);
    const res = await fetch(API + '/sessions?' + params);
    if (!res.ok) return;
    const data = await res.json();
    if (append) {
      sessions = sessions.concat(data.sessions);
    } else {
      sessions = data.sessions;
    }
    cursor = data.nextCursor || null;
    hasMore = !!cursor;
    if (!selected && sessions.length > 0) selected = sessions[0].id;
    render();
  }

  function filtered() {
    return sessions.filter(s => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!query) return true;
      return (s.id + (s.status || '')).toLowerCase().includes(query.toLowerCase());
    });
  }

  function statusClass(status) {
    return 'status-' + status;
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function renderSidebar() {
    const counts = { all: sessions.length, running: 0, completed: 0, error: 0 };
    sessions.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
    $('total-count').textContent = sessions.length;

    const chips = $('filter-chips');
    chips.innerHTML = '';
    ['all','running','completed','error'].forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (filter === f ? ' active' : '');
      btn.innerHTML = f.charAt(0).toUpperCase() + f.slice(1) + '<span class="chip-count">' + (counts[f] || 0) + '</span>';
      btn.onclick = () => { filter = f; render(); };
      chips.appendChild(btn);
    });

    const list = $('session-list');
    list.innerHTML = '';
    const items = filtered();
    if (items.length === 0) {
      list.innerHTML = '<div class="empty">No matching sessions</div>';
      return;
    }
    items.forEach(s => {
      const row = document.createElement('div');
      row.className = 'session-row' + (s.id === selected ? ' active' : '');
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span class="badge-dot ' + statusClass(s.status) + '" style="width:8px;height:8px;border-radius:50;flex:none;' +
            'background:var(--' + (s.status === 'running' ? 'blue' : s.status === 'error' ? 'red' : 'green') + ');' +
            (s.status === 'running' ? 'animation:pulse 1.3s ease infinite;' : '') + '"></span>' +
          '<span style="font:500 12px monospace;color:var(--text);">' + escapeHtml(s.id.slice(0, 19)) + '</span>' +
          '<div style="flex:1;"></div>' +
          '<span style="font:11px monospace;color:var(--text-faint);">' + escapeHtml(timeAgo(s.createdAt)) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">' +
          '<span class="badge ' + statusClass(s.status) + '">' +
            '<span class="badge-dot"></span>' + escapeHtml(s.status.toUpperCase()) +
          '</span>' +
        '</div>';
      row.onclick = () => { selected = s.id; tab = 'report'; history.pushState(null, '', '/sessions/' + encodeURIComponent(s.id)); render(); loadDetail(); schedulePolling(); };
      list.appendChild(row);
    });
    if (hasMore) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.cssText = 'width:calc(100% - 24px);margin:12px;justify-content:center;';
      btn.textContent = 'Load more';
      btn.onclick = () => fetchSessions(true);
      list.appendChild(btn);
    }
  }

  async function loadDetail() {
    if (!selected) return;
    renderDetailHead();
    renderTabs();
    await loadTabContent();
  }

  function renderDetailHead() {
    const s = sessions.find(x => x.id === selected);
    if (!s) return;
    const head = $('detail-head');
    head.innerHTML =
      '<div style="display:flex;align-items:center;gap:11px;">' +
        '<span class="badge badge-lg ' + statusClass(s.status) + '"><span class="badge-dot"></span>' + escapeHtml(s.status.toUpperCase()) + '</span>' +
        '<span style="font:600 16px monospace;color:var(--text);">' + escapeHtml(s.id) + '</span>' +
        '<div style="flex:1;"></div>' +
        '<button class="btn" id="btn-copy-url">\\u29C9 Copy URL</button>' +
        '<button class="btn" id="btn-export">\\u2193 Export</button>' +
        '<button class="btn btn-primary" id="btn-handoff">Handoff \\u2192</button>' +
      '</div>' +
      '<div class="detail-meta">' +
        '<span>Created <span style="color:var(--text-dim);font-family:monospace;">' + escapeHtml(s.createdAt) + '</span></span>' +
        '<span>Status <span style="color:var(--text-dim);">' + escapeHtml(s.status) + '</span></span>' +
      '</div>' +
      '<div class="tabs" id="tabs"></div>';
    $('btn-copy-url')?.addEventListener('click', () => {
      const url = location.origin + '/sessions/' + encodeURIComponent(selected);
      navigator.clipboard.writeText(url).then(() => toast('URL copied'));
    });
    $('btn-export')?.addEventListener('click', onExport);
    $('btn-handoff')?.addEventListener('click', () => openHandoff());
    renderTabs();
  }

  function renderTabs() {
    const tabsEl = $('tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    ['report','runbooks','artifacts','transcript'].forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (tab === t ? ' active' : '');
      btn.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      btn.onclick = () => { tab = t; renderTabs(); loadTabContent(); };
      tabsEl.appendChild(btn);
    });
  }

  async function loadTabContent() {
    const area = $('content-area');
    if (!selected) { area.innerHTML = '<div class="empty">Select a session</div>'; return; }
    area.innerHTML = '<div class="empty">Loading...</div>';

    if (tab === 'report') {
      const s = sessions.find(x => x.id === selected);
      const isRunning = s && s.status === 'running';
      let html = '';
      if (isRunning) {
        html += '<div class="loading"><span class="spinner"></span><span>Investigation in progress...</span></div>';
      }
      const res = await fetch(API + '/sessions/' + selected + '/report');
      if (res.ok) {
        const md = await res.text();
        html += renderMarkdown(md);
      } else if (!isRunning) {
        html = '<div class="empty">No report available</div>';
      }
      area.innerHTML = html || '<div class="empty">Waiting for report...</div>';
    } else if (tab === 'runbooks') {
      const res = await fetch(API + '/sessions/' + selected + '/runbooks');
      if (!res.ok) { area.innerHTML = '<div class="empty">No runbook reports</div>'; return; }
      const entries = await res.json();
      if (entries.length === 0) { area.innerHTML = '<div class="empty">No runbook reports</div>'; return; }
      let html = '';
      for (const entry of entries) {
        const rid = entry.runbookId.replace(/--/g, '/');
        const reportRes = await fetch(API + '/sessions/' + selected + '/runbooks/' + encodeURIComponent(entry.runbookId) + '/' + encodeURIComponent(entry.toolUseId) + '/report');
        const body = reportRes.ok ? renderMarkdown(await reportRes.text()) : '<div class="empty">Failed to load report</div>';
        html +=
          '<div class="runbook-card">' +
            '<div class="runbook-header" onclick="this.parentElement.querySelector(\\'.runbook-body\\').style.display=this.parentElement.querySelector(\\'.runbook-body\\').style.display===\\'none\\'?\\'block\\':\\'none\\'">' +
              '<span style="font:600 14px system-ui;color:var(--text);">' + escapeHtml(rid) + '</span>' +
              '<span style="font:10px monospace;color:var(--text-faint);">' + escapeHtml(entry.toolUseId) + '</span>' +
            '</div>' +
            '<div class="runbook-body">' + body + '</div>' +
          '</div>';
      }
      area.innerHTML = html;
    } else if (tab === 'artifacts') {
      const res = await fetch(API + '/sessions/' + selected + '/artifacts');
      if (!res.ok) { area.innerHTML = '<div class="empty">No artifacts</div>'; return; }
      const names = await res.json();
      if (names.length === 0) { area.innerHTML = '<div class="empty">No artifacts</div>'; return; }
      let html = '';
      for (const n of names) {
        const ext = (n.split('.').pop() || '').toLowerCase();
        const textExts = ['csv','tsv','txt','md','json','jsonl','log'];
        const imageExts = ['png','jpg','jpeg','gif','svg','webp'];
        let preview = '';
        const artifactUrl = API + '/sessions/' + encodeURIComponent(selected) + '/artifacts/' + encodeURIComponent(n);
        if (imageExts.indexOf(ext) !== -1) {
          preview = '<div style="padding:12px 15px;text-align:center;"><img src="' + artifactUrl + '" style="max-width:100%;max-height:600px;border-radius:4px;" /></div>';
        } else if (textExts.indexOf(ext) !== -1) {
          const pRes = await fetch(artifactUrl);
          if (pRes.ok) {
            const text = await pRes.text();
            if (ext === 'csv' || ext === 'tsv') {
              preview = renderCsvPreview(text, ext === 'tsv' ? '\\t' : ',');
            } else if (ext === 'md') {
              preview = '<div style="padding:12px 15px;">' + renderMarkdown(text) + '</div>';
            } else {
              preview = '<pre style="margin:0;max-height:400px;overflow:auto;">' + escapeHtml(text.slice(0, 10000)) + '</pre>';
            }
          }
        }
        html +=
          '<div class="artifact-card"><div class="artifact-header">' +
            '<span class="artifact-ext" style="color:var(--accent);background:var(--accent-soft);">' + escapeHtml(ext.toUpperCase()) + '</span>' +
            '<span style="font:500 13px monospace;color:var(--text);">' + escapeHtml(n) + '</span>' +
            '<div style="flex:1;"></div>' +
            '<a href="' + artifactUrl + '" style="font:500 11px system-ui;color:var(--accent);">\\u2193 Download</a>' +
          '</div>' +
          (preview ? '<div style="border-top:1px solid var(--border);">' + preview + '</div>' : '') +
          '</div>';
      }
      area.innerHTML = html;
    } else if (tab === 'transcript') {
      const res = await fetch(API + '/sessions/' + selected + '/transcript');
      if (!res.ok) { area.innerHTML = '<div class="empty">No transcript</div>'; return; }
      const events = await res.json();
      if (events.length === 0) { area.innerHTML = '<div class="empty">No transcript events</div>'; return; }
      area.innerHTML = events.map(ev => {
        const role = ev.type || 'unknown';
        const borderColor = role === 'assistant' ? 'var(--accent)' : role === 'user' ? 'var(--blue)' : role === 'system' ? 'var(--text-faint)' : 'var(--border-2)';
        const tagBg = role === 'assistant' ? 'var(--accent-soft)' : role === 'user' ? 'var(--blue-soft)' : 'var(--panel-3)';
        const tagColor = role === 'assistant' ? 'var(--accent)' : role === 'user' ? 'var(--blue)' : 'var(--text-faint)';
        let label = role;
        let text = '';
        if (ev.type === 'system') {
          label = 'system:' + (ev.subtype || '');
          if (ev.subtype === 'init') {
            text = 'model: ' + (ev.model || '(default)');
          } else if (ev.subtype === 'hook_started') {
            text = '[' + (ev.hook_event || '') + '] ' + (ev.hook_name || '');
          } else if (ev.subtype === 'hook_response') {
            text = '[' + (ev.hook_event || '') + '] ' + (ev.hook_name || '') + ' \\u2192 ' + (ev.outcome || '') + (ev.exit_code !== undefined ? ' (exit ' + ev.exit_code + ')' : '') + (ev.output ? '\\n' + ev.output : '');
          } else if (ev.subtype === 'hook_progress') {
            text = '[' + (ev.hook_event || '') + '] ' + (ev.hook_name || '') + (ev.output ? '\\n' + ev.output : '');
          } else if (ev.subtype === 'api_retry') {
            text = 'attempt ' + (ev.attempt || '') + '/' + (ev.max_retries || '') + (ev.error_status ? ' (HTTP ' + ev.error_status + ')' : '') + ' retry in ' + (ev.retry_delay_ms || 0) + 'ms';
          } else if (ev.subtype === 'task_started') {
            text = (ev.description || '') + (ev.subagent_type ? ' (' + ev.subagent_type + ')' : '') + (ev.task_type ? ' [' + ev.task_type + ']' : '');
          } else if (ev.subtype === 'task_notification') {
            text = (ev.status || '') + (ev.summary ? ': ' + ev.summary : '');
            if (ev.usage) { var u = ev.usage; text += '\\n' + (u.total_tokens || 0) + ' tokens, ' + (u.tool_uses || 0) + ' tool uses, ' + (u.duration_ms || 0) + 'ms'; }
          } else if (ev.subtype === 'task_progress') {
            text = ev.description || '';
          } else if (ev.subtype === 'task_updated') {
            var p = ev.patch || {};
            text = Object.keys(p).map(function(k) { return k + ': ' + p[k]; }).join(', ');
          } else if (ev.subtype === 'tool_use_summary' || ev.type === 'tool_use_summary') {
            text = ev.summary || '';
          } else {
            text = JSON.stringify(ev, null, 2);
          }
        } else if (ev.type === 'result') {
          label = 'result';
          text = (ev.subtype || 'success') + ' | turns: ' + (ev.num_turns || 0) + ' | cost: $' + (ev.total_cost_usd != null ? ev.total_cost_usd.toFixed(4) : '?');
        } else if (ev.type === 'tool_use_summary') {
          label = 'tool_use_summary';
          text = ev.summary || '';
        } else {
          text = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content || '', null, 2);
        }
        if (ev.type === 'assistant') {
          if (ev.subagent_type) label = 'assistant (' + ev.subagent_type + ')';
          if (ev.task_description) text = (text ? text + '\\n\\n' : '') + '[task: ' + ev.task_description + ']';
        }
        if (ev.tool_use && Array.isArray(ev.tool_use) && ev.tool_use.length > 0) {
          text += (text ? '\\n\\n' : '') + '--- tool calls ---\\n' + ev.tool_use.map(t => t.name + ' (' + t.id + ')').join('\\n');
        }
        return '<div class="transcript-entry" style="border-left:3px solid ' + borderColor + ';">' +
          '<div style="display:flex;align-items:center;gap:9px;">' +
            '<span class="transcript-tag" style="color:' + tagColor + ';background:' + tagBg + ';">' + escapeHtml(label) + '</span>' +
            '<span style="font:11px monospace;color:var(--text-faint);">' + escapeHtml(ev.timestamp || '') + '</span>' +
          '</div>' +
          '<div style="font:13px/1.6 system-ui;color:var(--text-dim);margin-top:6px;white-space:pre-wrap;">' + escapeHtml(text.slice(0, 2000)) + '</div>' +
        '</div>';
      }).join('');
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderMarkdown(md) {
    const lines = md.split('\\n');
    let html = '';
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (/^\`\`\`/.test(ln)) {
        const buf = []; i++;
        while (i < lines.length && !/^\`\`\`/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html += '<pre>' + escapeHtml(buf.join('\\n')) + '</pre>';
        continue;
      }
      if (/^\\|(.+)\\|\\s*$/.test(ln) && i+1 < lines.length && /^\\|[\\s:|-]+\\|\\s*$/.test(lines[i+1])) {
        const row = l => l.trim().replace(/^\\||\\|$/g,'').split('|').map(c => c.trim());
        const head = row(ln); i += 2; const body = [];
        while (i < lines.length && /^\\|(.+)\\|\\s*$/.test(lines[i])) { body.push(row(lines[i])); i++; }
        html += '<table><thead><tr>' + head.map(h => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>' +
          body.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
        continue;
      }
      let m;
      if (m = ln.match(/^(#{1,4})\\s+(.*)/)) {
        const lv = m[1].length;
        const sz = [0,23,18,15,13][lv];
        html += '<div style="font:700 ' + sz + 'px system-ui;color:var(--text);margin:' + (lv <= 2 ? 26 : 16) + 'px 0 10px;' + (lv <= 2 ? 'padding-bottom:7px;border-bottom:1px solid var(--border);' : '') + '">' + escapeHtml(m[2]) + '</div>';
        i++; continue;
      }
      if (/^\\s*[-*]\\s+/.test(ln)) {
        const items = [];
        while (i < lines.length && /^\\s*[-*]\\s+/.test(lines[i])) { items.push(lines[i].replace(/^\\s*[-*]\\s+/,'')); i++; }
        html += '<ul style="margin:8px 0;padding-left:20px;display:flex;flex-direction:column;gap:5px;">' +
          items.map(t => '<li style="font:13px/1.65 system-ui;color:var(--text-dim);">' + escapeHtml(t) + '</li>').join('') + '</ul>';
        continue;
      }
      if (/^\\s*\\d+\\.\\s+/.test(ln)) {
        const items = [];
        while (i < lines.length && /^\\s*\\d+\\.\\s+/.test(lines[i])) { items.push(lines[i].replace(/^\\s*\\d+\\.\\s+/,'')); i++; }
        html += '<ol style="margin:8px 0;padding-left:22px;display:flex;flex-direction:column;gap:5px;">' +
          items.map(t => '<li style="font:13px/1.65 system-ui;color:var(--text-dim);">' + escapeHtml(t) + '</li>').join('') + '</ol>';
        continue;
      }
      if (ln.trim() === '') { i++; continue; }
      html += '<p style="margin:9px 0;font:13px/1.7 system-ui;color:var(--text-dim);">' + escapeHtml(ln) + '</p>';
      i++;
    }
    return html;
  }

  function renderCsvPreview(text, sep) {
    const rows = text.split('\\n').filter(r => r.trim());
    if (rows.length === 0) return '';
    const maxRows = Math.min(rows.length, 100);
    const parse = r => {
      const cells = []; let cur = ''; let inQ = false;
      for (let c = 0; c < r.length; c++) {
        if (inQ) {
          if (r[c] === '"' && r[c+1] === '"') { cur += '"'; c++; }
          else if (r[c] === '"') { inQ = false; }
          else { cur += r[c]; }
        } else {
          if (r[c] === '"') { inQ = true; }
          else if (r[c] === sep) { cells.push(cur); cur = ''; }
          else { cur += r[c]; }
        }
      }
      cells.push(cur);
      return cells;
    };
    const header = parse(rows[0]);
    let html = '<div style="overflow-x:auto;"><table><thead><tr>' +
      header.map(h => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>';
    for (let i = 1; i < maxRows; i++) {
      const cells = parse(rows[i]);
      html += '<tr>' + cells.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>';
    }
    html += '</tbody></table></div>';
    if (rows.length > maxRows) {
      html += '<div style="padding:8px 12px;font:11px system-ui;color:var(--text-faint);">Showing ' + maxRows + ' of ' + rows.length + ' rows</div>';
    }
    return html;
  }

  async function onExport() {
    const res = await fetch(API + '/sessions/' + selected + '/export-url', { method: 'POST' });
    if (!res.ok) { toast('Export failed'); return; }
    const data = await res.json();
    window.open(data.url, '_blank');
    toast('Export started');
  }

  function openHandoff() {
    const modal = $('handoff-modal');
    modal.style.display = 'flex';
    modal.innerHTML =
      '<div class="modal" onclick="event.stopPropagation()">' +
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 14px;border-bottom:1px solid var(--border);">' +
          '<span style="width:30px;height:30px;border-radius:7px;background:var(--accent-soft);color:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-size:15px;">\\u21C4</span>' +
          '<div><div style="font:600 15px system-ui;color:var(--text);">Handoff to a coding agent</div>' +
          '<div style="font:12px monospace;color:var(--text-faint);margin-top:2px;">' + escapeHtml(selected || '') + '</div></div>' +
          '<div style="flex:1;"></div>' +
          '<button class="btn btn-icon" id="close-handoff">\\u2715</button>' +
        '</div>' +
        '<div style="padding:18px 22px 22px;display:flex;flex-direction:column;gap:16px;">' +
          '<div>' +
            '<div style="font:600 11px system-ui;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim);margin-bottom:7px;">Generated prompt</div>' +
            '<pre id="prompt-text" style="max-height:200px;white-space:pre-wrap;word-break:break-word;"></pre>' +
          '</div>' +
          '<div style="display:flex;gap:10px;padding-top:2px;">' +
            '<button class="btn" style="flex:1;height:40px;justify-content:center;" id="cancel-handoff">Cancel</button>' +
            '<button class="btn btn-primary" style="flex:2;height:40px;justify-content:center;" id="send-handoff">\\u29C9 Copy prompt</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    modal.onclick = closeHandoff;
    $('close-handoff').onclick = closeHandoff;
    $('cancel-handoff').onclick = closeHandoff;
    generatePrompt();
    $('send-handoff').onclick = copyPrompt;
  }

  async function generatePrompt() {
    const res = await fetch(API + '/sessions/' + selected + '/export-url', { method: 'POST' });
    let url = '(export URL generation failed)';
    if (res.ok) {
      const data = await res.json();
      url = data.url;
    }
    const prompt = 'Import this prepalert session:\\ncurl -sL "' + url + '" -o session.zip && unzip -o session.zip -d ./session\\n\\nReview the report.md for investigation results.';
    $('prompt-text').textContent = prompt;
  }

  function copyPrompt() {
    const text = $('prompt-text').textContent;
    navigator.clipboard.writeText(text).then(() => toast('Prompt copied to clipboard'));
  }

  function closeHandoff() {
    $('handoff-modal').style.display = 'none';
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2200);
  }

  $('search-input').oninput = e => { query = e.target.value; render(); };

  window.onpopstate = () => {
    const m = location.pathname.match(/^\\/sessions\\/(.+)/);
    selected = m ? decodeURIComponent(m[1]) : null;
    tab = 'report';
    render();
    loadDetail();
    schedulePolling();
  };

  let detailPollTimer = null;
  let listPollTimer = null;

  function startDetailPolling() {
    stopDetailPolling();
    detailPollTimer = setInterval(async () => {
      if (!selected) return;
      const s = sessions.find(x => x.id === selected);
      if (!s || s.status !== 'running') { stopDetailPolling(); return; }
      const res = await fetch(API + '/sessions/' + selected);
      if (!res.ok) return;
      const meta = await res.json();
      s.status = meta.status;
      s.createdAt = meta.createdAt;
      if (meta.status !== 'running') {
        stopDetailPolling();
        renderSidebar();
      }
      renderDetailHead();
      await loadTabContent();
    }, 5000);
  }

  function stopDetailPolling() {
    if (detailPollTimer) { clearInterval(detailPollTimer); detailPollTimer = null; }
  }

  function startListPolling() {
    stopListPolling();
    listPollTimer = setInterval(async () => {
      const hasRunning = sessions.some(s => s.status === 'running');
      if (!hasRunning) { stopListPolling(); return; }
      await fetchSessions(false);
    }, 10000);
  }

  function stopListPolling() {
    if (listPollTimer) { clearInterval(listPollTimer); listPollTimer = null; }
  }

  function schedulePolling() {
    const s = selected ? sessions.find(x => x.id === selected) : null;
    if (s && s.status === 'running') {
      startDetailPolling();
    } else {
      stopDetailPolling();
    }
    if (sessions.some(x => x.status === 'running')) {
      startListPolling();
    } else {
      stopListPolling();
    }
  }

  function render() {
    renderSidebar();
  }

  fetchSessions(false).then(() => { loadDetail(); schedulePolling(); });
})();
</script>
</body>
</html>`;
