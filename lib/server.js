/**
 * Loopback control panel: status, token entry, chat binding, whitelist, test
 * send, language switch. The server binds 127.0.0.1 only; POSTs require a
 * per-process CSRF header.
 */

import http from 'node:http';
import { DICT, LANGUAGES } from './i18n.js';

const MAX_BODY = 32 * 1024;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'none'; base-uri 'none'",
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const fail = (code) => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail('error.tooLarge');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        fail('error.badJson');
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients such as curl
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function pageFor(relay) {
  const options = LANGUAGES.map((language) => `<option value="${language.id}">${language.label}</option>`).join('');
  // Escape `<` so the JSON cannot terminate the inline script early.
  const dict = JSON.stringify(DICT).replace(/</g, '\\u003c');
  return PAGE.replace('__CSRF__', relay.csrfToken)
    .replace('__LANG_OPTIONS__', options)
    .replace('__I18N__', dict)
    .replace('__LANG__', JSON.stringify(relay.language));
}

function handle(relay, req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    html(res, pageFor(relay));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    json(res, 200, { ok: true, state: relay.state() });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/config') {
    if (!sameOrigin(req) || req.headers['x-relay-csrf'] !== relay.csrfToken) {
      json(res, 403, { ok: false, error: relay.t('error.forbidden') });
      return;
    }
    readBody(req)
      .then((body) => relay.saveConfig(body))
      .then((state) => json(res, 200, { ok: true, state }))
      .catch((error) =>
        json(res, 400, {
          ok: false,
          error: error?.code ? relay.t(error.code) : error?.message ?? String(error),
        }),
      );
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/test') {
    if (!sameOrigin(req) || req.headers['x-relay-csrf'] !== relay.csrfToken) {
      json(res, 403, { ok: false, error: relay.t('error.forbidden') });
      return;
    }
    relay
      .sendTest()
      .then((state) => json(res, 200, { ok: true, state }))
      .catch((error) => json(res, 400, { ok: false, error: error?.message ?? String(error) }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    if (!sameOrigin(req) || req.headers['x-relay-csrf'] !== relay.csrfToken) {
      json(res, 403, { ok: false, error: relay.t('error.forbidden') });
      return;
    }
    try {
      json(res, 200, { ok: true, state: relay.resetBinding() });
    } catch (error) {
      json(res, 400, { ok: false, error: error?.message ?? String(error) });
    }
    return;
  }
  json(res, 404, { ok: false, error: relay.t('error.notFound') });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Start the panel, falling back to an OS-assigned port when the configured one is busy. */
export async function startControlServer({ relay, host = '127.0.0.1', port = 7810 } = {}) {
  const server = http.createServer((req, res) => {
    try {
      handle(relay, req, res);
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message ?? 'internal error' });
    }
  });
  let actualPort = port;
  try {
    await listen(server, host, port);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    actualPort = 0;
    await listen(server, host, 0);
  }
  actualPort = server.address().port;
  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH · Telegram Relay</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --card:#171a21; --line:#262b36; --text:#e7e9ee; --muted:#98a0b3; --accent:#4f8cff; --ok:#3ecf8e; --warn:#f5a524; --err:#f36b6b; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f6fa; --card:#ffffff; --line:#dde2ea; --text:#151922; --muted:#5b6475; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  .head { display:flex; gap:16px; align-items:flex-start; justify-content:space-between; margin-bottom:24px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing:-0.01em; }
  .sub { color: var(--muted); margin: 0; font-size: 13px; }
  .build { font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; opacity: .7; margin-left: 8px; }
  .lang { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted); flex:0 0 auto; }
  select { padding:7px 9px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--text); font:inherit; font-size:13px; }
  .card { background: var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .stat { flex:1 1 160px; }
  .label { color: var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.06em; }
  .value { font-size:15px; margin-top:2px; overflow-wrap:anywhere; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--muted); margin-right:6px; vertical-align:1px; }
  .dot.on { background: var(--ok); } .dot.off { background: var(--err); }
  label { display:block; font-size:13px; color:var(--muted); margin:14px 0 6px; }
  input, textarea { width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:transparent; color:var(--text); font:inherit; }
  textarea { min-height:74px; resize:vertical; }
  input:focus, textarea:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
  input[type="checkbox"] { width:16px; height:16px; padding:0; border:0; accent-color:var(--accent); }
  .switch { position:relative; display:flex; align-items:center; gap:10px; margin:16px 0 0; color:var(--text); cursor:pointer; }
  .switch input { position:absolute; opacity:0; width:1px; height:1px; margin:0; }
  .switch .track { position:relative; flex:0 0 auto; width:36px; height:20px; border-radius:999px; background:var(--line); transition:background .15s ease; }
  .switch .thumb { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.35); transition:transform .15s ease; }
  .switch input:checked + .track { background:var(--accent); }
  .switch input:checked + .track .thumb { transform:translateX(16px); }
  .switch input:focus-visible + .track { outline:2px solid var(--accent); outline-offset:2px; }
  .suboptions { display:flex; flex-direction:column; gap:9px; margin:10px 0 0 46px; padding-left:12px; border-left:2px solid var(--line); }
  .suboptions[hidden] { display:none; }
  .check { display:flex; align-items:center; gap:8px; margin:0; color:var(--text); font-size:13px; cursor:pointer; }
  .actions { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
  button { padding:9px 14px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--text); font:inherit; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  .hint { color:var(--muted); font-size:13px; margin-top:12px; }
  .error { color:var(--err); font-size:13px; margin-top:10px; white-space:pre-wrap; }
  .ok { color:var(--ok); font-size:13px; margin-top:10px; }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:7px 0; border-bottom:1px solid var(--line); font-size:13px; display:flex; gap:10px; }
  li:last-child { border-bottom:0; }
  time { color:var(--muted); flex:0 0 44px; font-variant-numeric: tabular-nums; }
  .warn { color:var(--warn); }
  code { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
</style>
</head>
<body>
<main>
  <div class="head">
    <div>
      <h1>DSH · Telegram Relay</h1>
      <p class="sub"><span data-i18n="panel.subtitle"></span><span class="build" id="build"></span></p>
    </div>
    <label class="lang" for="lang"><span data-i18n="panel.language"></span>
      <select id="lang">__LANG_OPTIONS__</select>
    </label>
  </div>

  <section class="card">
    <div class="row">
      <div class="stat"><div class="label" data-i18n="panel.bot"></div><div class="value" id="bot"><span class="dot"></span>—</div></div>
      <div class="stat"><div class="label" data-i18n="panel.chat"></div><div class="value" id="chat">—</div></div>
      <div class="stat"><div class="label" data-i18n="panel.access"></div><div class="value" id="owner">—</div></div>
      <div class="stat"><div class="label" data-i18n="panel.pending"></div><div class="value" id="pending">—</div></div>
    </div>
    <div class="error" id="groupWarn" data-i18n="panel.groupWarn" hidden></div>
    <div class="error" id="lastError" hidden></div>
  </section>

  <section class="card">
    <div class="label" data-i18n="panel.connection"></div>
    <form id="config">
      <label for="token" data-i18n="panel.token"></label>
      <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="123456:ABC…">
      <label for="chatId" data-i18n="panel.chatId"></label>
      <input id="chatId" type="text" inputmode="numeric" autocomplete="off" placeholder="-1001234567890">
      <label for="allowed" data-i18n="panel.whitelist"></label>
      <textarea id="allowed" rows="3" spellcheck="false" placeholder="@alice, https://t.me/bob, 123456789"></textarea>
      <label class="switch">
        <input type="checkbox" id="subagents">
        <span class="track"><span class="thumb"></span></span>
        <span data-i18n="panel.subagents"></span>
      </label>
      <div class="suboptions" id="subagentOptions">
        <label class="check">
          <input type="checkbox" id="subagentTurnEnd">
          <span data-i18n="panel.subagentTurnEnd"></span>
        </label>
        <label class="check">
          <input type="checkbox" id="subagentQuestions">
          <span data-i18n="panel.subagentQuestions"></span>
        </label>
      </div>
      <div class="actions">
        <button class="primary" type="submit" id="save" data-i18n="panel.save"></button>
        <button type="button" id="test" data-i18n="panel.test"></button>
        <button type="button" id="reset" data-i18n="panel.reset"></button>
      </div>
      <div class="error" id="formError" hidden></div>
      <div class="ok" id="formOk" hidden></div>
      <p class="hint" data-i18n="panel.hint"></p>
    </form>
  </section>

  <section class="card">
    <div class="label" data-i18n="panel.events"></div>
    <ul id="log"><li><time>—</time><span data-i18n="panel.loading"></span></li></ul>
  </section>
</main>
<script>
const CSRF = "__CSRF__";
const I18N = __I18N__;
let LANG = __LANG__;
let formFilled = false;
let lastState = null;
const $ = (id) => document.getElementById(id);

function t(key, params) {
  const table = I18N[LANG] || I18N.ru;
  const template = table[key] || I18N.en[key] || I18N.ru[key] || key;
  return String(template).replace(/\\{(\\w+)\\}/g, (match, name) =>
    params && params[name] !== undefined ? String(params[name]) : match);
}
function applyI18n() {
  document.documentElement.lang = LANG;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  $('lang').value = LANG;
}
function setError(id, message) {
  const node = $(id);
  if (!message) { node.hidden = true; node.textContent = ''; return; }
  node.hidden = false; node.textContent = message;
}
function syncSubagentOptions() {
  $('subagentOptions').hidden = !$('subagents').checked;
}
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-relay-csrf': CSRF },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function render(state) {
  lastState = state;
  if (state.language && state.language !== LANG) {
    LANG = state.language;
    applyI18n();
  }
  $('build').textContent = state.build ? 'build ' + state.build : '';
  const bot = $('bot');
  bot.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'dot ' + (state.running ? 'on' : 'off');
  bot.appendChild(dot);
  bot.appendChild(document.createTextNode(state.bot ? '@' + state.bot.username : t('panel.notConnected')));
  $('chat').textContent = state.chatId || t('panel.notBound');
  $('owner').textContent = state.owner
    ? (state.owner.username ? '@' + state.owner.username : 'id ' + state.owner.id)
    : ((state.allowedUsers || []).length ? t('panel.whitelistShort') : '—');
  $('groupWarn').hidden = !(state.chatId && String(state.chatId).startsWith('-'));
  if (!formFilled) {
    $('chatId').value = state.chatId || '';
    $('allowed').value = (state.allowedUsers || []).join(', ');
    $('subagents').checked = state.notifySubagents !== false;
    $('subagentTurnEnd').checked = state.notifySubagentTurnEnd !== false;
    $('subagentQuestions').checked = state.notifySubagentQuestions !== false;
    syncSubagentOptions();
    formFilled = true;
  } else if (document.activeElement !== $('chatId') && $('chatId').value !== (state.chatId || '')) {
    // /start can bind after the page loaded; keep the field in sync so a later
    // save does not submit an empty chat id and unbind it.
    $('chatId').value = state.chatId || '';
  }
  $('pending').textContent = t('panel.pendingLine', {
    questions: state.pending.questions,
    approvals: state.pending.approvals,
  });
  const err = $('lastError');
  if (state.lastError) { err.hidden = false; err.textContent = state.lastError; } else { err.hidden = true; }
  const log = $('log');
  log.textContent = '';
  const rows = (state.recent || []).slice().reverse();
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.textContent = t('panel.empty');
    log.appendChild(li);
    return;
  }
  for (const row of rows) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date(row.time).toLocaleTimeString(
      LANG === 'ru' ? 'ru-RU' : LANG === 'zh' ? 'zh-CN' : 'en-US',
      { hour: '2-digit', minute: '2-digit' },
    );
    const text = document.createElement('span');
    text.textContent = row.key ? t(row.key, row.params) : String(row.text ?? '');
    if (row.kind === 'warn') text.className = 'warn';
    li.appendChild(time); li.appendChild(text);
    log.appendChild(li);
  }
}
async function refresh() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) render(data.state);
  } catch (error) {
    setError('lastError', t('panel.unreachable', { error: error.message }));
  }
}
$('lang').addEventListener('change', async () => {
  LANG = $('lang').value;
  applyI18n();
  if (lastState) {
    lastState.language = LANG;
    render(lastState);
  }
  try {
    const data = await api('/api/config', { language: LANG });
    render(data.state);
  } catch (error) {
    setError('formError', error.message);
  }
});
$('subagents').addEventListener('change', syncSubagentOptions);
$('config').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('formError', ''); setError('formOk', '');
  $('save').disabled = true;
  try {
    const payload = {
      chatId: $('chatId').value.trim(),
      allowedUsers: $('allowed').value,
      language: LANG,
      notifySubagents: $('subagents').checked,
      notifySubagentTurnEnd: $('subagentTurnEnd').checked,
      notifySubagentQuestions: $('subagentQuestions').checked,
    };
    const token = $('token').value.trim();
    if (token) payload.token = token;
    const data = await api('/api/config', payload);
    $('token').value = '';
    $('allowed').value = (data.state.allowedUsers || []).join(', ');
    $('chatId').value = data.state.chatId || '';
    $('subagents').checked = data.state.notifySubagents !== false;
    $('subagentTurnEnd').checked = data.state.notifySubagentTurnEnd !== false;
    $('subagentQuestions').checked = data.state.notifySubagentQuestions !== false;
    syncSubagentOptions();
    render(data.state);
    $('formOk').hidden = false;
    $('formOk').textContent = t('panel.saved');
  } catch (error) {
    setError('formError', error.message);
  } finally {
    $('save').disabled = false;
  }
});
$('test').addEventListener('click', async () => {
  setError('formError', ''); setError('formOk', '');
  $('test').disabled = true;
  try {
    await api('/api/test', {});
    $('formOk').hidden = false;
    $('formOk').textContent = t('panel.testSent');
  } catch (error) {
    setError('formError', error.message);
  } finally {
    $('test').disabled = false;
  }
});
$('reset').addEventListener('click', async () => {
  if (!confirm(t('panel.confirmReset'))) return;
  setError('formError', ''); setError('formOk', '');
  try {
    const data = await api('/api/reset', {});
    $('chatId').value = '';
    render(data.state);
    $('formOk').hidden = false;
    $('formOk').textContent = t('panel.resetDone');
  } catch (error) {
    setError('formError', error.message);
  }
});
applyI18n();
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
