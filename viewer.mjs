import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.VIEWER_PORT || 3000;

// ── バックアップディレクトリ検索 ──────────────────────────────────
function findBackupDirs() {
  return fs.readdirSync(__dirname)
    .filter(d => /^slack-backup-\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => fs.statSync(path.join(__dirname, d)).isDirectory())
    .sort(); // 日付順（古→新）
}

// ── マージ：同じ ts は新しいバックアップで上書き ──────────────────
function mergeMessages(msgArraysList) {
  const map = new Map();
  for (const msgs of msgArraysList) {
    for (const msg of msgs) map.set(msg.ts, msg);
  }
  return [...map.values()].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
}

function mergeObjects(list) {
  return Object.assign({}, ...list);
}

// ── データ読み込み ─────────────────────────────────────────────────
let backupDirs = [];
let usersMap = {};
let channelsData = {};
let dmsData = {};

function safeReadJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function loadData() {
  backupDirs = findBackupDirs();
  if (backupDirs.length === 0) { console.warn('Warning: No backup directories found.'); return; }

  // users
  usersMap = mergeObjects(
    backupDirs.map(d => safeReadJSON(path.join(__dirname, d, 'users.json')) || {})
  );

  // channels
  const allChannelNames = new Set();
  for (const d of backupDirs) {
    const dir = path.join(__dirname, d, 'channels');
    if (fs.existsSync(dir))
      fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        .forEach(f => allChannelNames.add(f.slice(0, -5)));
  }
  for (const name of allChannelNames) {
    const msgArraysList = [];
    let latestInfo = null;
    for (const d of backupDirs) {
      const data = safeReadJSON(path.join(__dirname, d, 'channels', `${name}.json`));
      if (!data) continue;
      msgArraysList.push(data.messages || []);
      latestInfo = data.channel_info;
    }
    channelsData[name] = { channel_info: latestInfo, messages: mergeMessages(msgArraysList) };
  }

  // dms
  const allDmNames = new Set();
  for (const d of backupDirs) {
    const dir = path.join(__dirname, d, 'dms');
    if (fs.existsSync(dir))
      fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        .forEach(f => allDmNames.add(f.slice(0, -5)));
  }
  for (const name of allDmNames) {
    const msgArraysList = [];
    let latestInfo = null;
    for (const d of backupDirs) {
      const data = safeReadJSON(path.join(__dirname, d, 'dms', `${name}.json`));
      if (!data) continue;
      msgArraysList.push(data.messages || []);
      latestInfo = data.dm_info;
    }
    dmsData[name] = { dm_info: latestInfo, messages: mergeMessages(msgArraysList) };
  }

  console.log(`Loaded ${backupDirs.length} backup(s): ${Object.keys(channelsData).length} channels, ${Object.keys(dmsData).length} DMs`);
}

// ── HTML ───────────────────────────────────────────────────────────
function getHTML() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slack Backup Viewer</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:15px;color:#1D1C1D;background:#fff;display:flex;height:100vh;overflow:hidden}

/* Sidebar */
#sidebar{width:260px;background:#3F0E40;color:rgba(255,255,255,.72);display:flex;flex-direction:column;flex-shrink:0;height:100vh}
#sidebar-header{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
.workspace-name{font-size:18px;font-weight:900;color:#fff;letter-spacing:-.3px}
.backup-info{font-size:12px;color:rgba(255,255,255,.45);margin-top:3px}
#sidebar-body{overflow-y:auto;flex:1;padding:8px 0}
.nav-section{padding:12px 16px 4px;font-size:13px;font-weight:700;color:rgba(255,255,255,.72)}
.nav-item{display:flex;align-items:center;gap:6px;padding:5px 16px;cursor:pointer;border-radius:4px;margin:1px 4px;color:rgba(255,255,255,.72);font-size:15px;white-space:nowrap;overflow:hidden}
.nav-item:hover{background:rgba(255,255,255,.1);color:#fff}
.nav-item.active{background:#1164A3;color:#fff}
.nav-item .prefix{flex-shrink:0;opacity:.8}
.nav-item .label{overflow:hidden;text-overflow:ellipsis;flex:1}
.nav-item .cnt{flex-shrink:0;font-size:11px;background:rgba(255,255,255,.25);border-radius:10px;padding:0 5px}

/* Main */
#main{flex:1;display:flex;flex-direction:column;overflow:hidden}
#main-header{padding:12px 20px;border-bottom:1px solid #e8e8e8;min-height:50px}
#main-title{font-size:18px;font-weight:900;color:#1D1C1D}
#main-meta{font-size:13px;color:#616061;margin-top:2px}
#messages-pane{flex:1;overflow-y:auto;padding:8px 0 24px}

/* Date separator */
.date-sep{display:flex;align-items:center;margin:16px 20px 8px;gap:8px}
.date-sep .line{flex:1;height:1px;background:#E0E0E0}
.date-sep .dlabel{font-size:13px;font-weight:700;color:#616061;border:1px solid #E0E0E0;border-radius:12px;padding:2px 12px;white-space:nowrap}

/* Message */
.msg{display:flex;gap:10px;padding:4px 20px}
.msg:hover{background:#F8F8F8}
.avatar{width:36px;height:36px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;margin-top:2px;user-select:none}
.msg-body{flex:1;min-width:0}
.msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.msg-author{font-weight:700;font-size:15px;color:#1D1C1D}
.msg-time{font-size:12px;color:#616061}
.msg-text{font-size:15px;color:#1D1C1D;line-height:1.46;word-break:break-word}
.msg-text a{color:#1264A3}
.msg-text code{background:rgba(29,28,29,.08);border:1px solid rgba(29,28,29,.13);border-radius:3px;padding:0 3px;font-size:12px;font-family:Monaco,Menlo,Consolas,monospace}
.msg-text strong{font-weight:700}
.msg-text em{font-style:italic}
.msg-text del{text-decoration:line-through}

/* Reactions */
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.reaction{display:inline-flex;align-items:center;gap:4px;background:#F8F8F8;border:1px solid #E0E0E0;border-radius:12px;padding:1px 7px;font-size:13px}

/* Thread */
.thread-toggle{display:inline-flex;align-items:center;gap:5px;margin-top:5px;font-size:13px;font-weight:700;color:#1264A3;cursor:pointer}
.thread-toggle:hover{text-decoration:underline}
.thread-body{margin-top:6px;padding:8px 12px;background:#F8F8F8;border-radius:4px;border-left:2px solid #E0E0E0}
.thread-msg{display:flex;gap:8px;padding:3px 0}
.sm-avatar{width:24px;height:24px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px;margin-top:1px;user-select:none}
.thread-content{flex:1;min-width:0}
.thread-hdr{display:flex;align-items:baseline;gap:6px}
.thread-author{font-weight:700;font-size:13px;color:#1D1C1D}
.thread-time{font-size:11px;color:#616061}
.thread-text{font-size:13px;color:#1D1C1D;line-height:1.46;word-break:break-word}

/* Utils */
.placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:#616061;font-size:16px}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-thumb{background:rgba(29,28,29,.2);border-radius:3px}
::-webkit-scrollbar-track{background:transparent}
</style>
</head>
<body>
<div id="sidebar">
  <div id="sidebar-header">
    <div class="workspace-name">Slack Backup</div>
    <div class="backup-info" id="backup-info">読み込み中...</div>
  </div>
  <div id="sidebar-body">
    <div class="nav-section">チャンネル</div>
    <div id="channels-list"></div>
    <div class="nav-section">ダイレクトメッセージ</div>
    <div id="dms-list"></div>
  </div>
</div>

<div id="main">
  <div id="main-header">
    <div id="main-title">チャンネルを選択</div>
    <div id="main-meta"></div>
  </div>
  <div id="messages-pane">
    <div class="placeholder">左のサイドバーから選択してください</div>
  </div>
</div>

<script>
var users = {};
var COLORS = ['#E01E5A','#ECB22E','#2EB67D','#36C5F0','#6F42C1','#FF6B35','#0A7D6E','#1264A3'];

function avatarColor(id) {
  var h = 0;
  for (var i = 0; i < (id||'').length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xFFFF;
  return COLORS[h % COLORS.length];
}
function initials(name) {
  var s = (name||'?').trim().split(/\\s+/).map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
  return s || '?';
}
function getUser(uid) { return users[uid] || {name:uid,real_name:uid,display_name:uid}; }
function userName(uid) {
  var u = getUser(uid);
  return u.display_name || u.real_name || u.name || uid;
}
function formatTs(ts) {
  var d = new Date(parseFloat(ts)*1000);
  return d.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function dateLabel(ts) {
  var d = new Date(parseFloat(ts)*1000);
  return d.toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtText(text) {
  if (!text) return '';
  var s = esc(text);
  s = s.replace(/&lt;@([A-Z0-9]+)&gt;/g, function(_,uid){ return '<strong>@'+esc(userName(uid))+'</strong>'; });
  s = s.replace(/&lt;#[A-Z0-9]+\\|([^&]+)&gt;/g, function(_,n){ return '<strong>#'+esc(n)+'</strong>'; });
  s = s.replace(/&lt;!(here|channel|everyone)&gt;/g, '<strong>@$1</strong>');
  s = s.replace(/&lt;([^|&]+)\\|([^&]+)&gt;/g, '<a href="$1" target="_blank">$2</a>');
  s = s.replace(/&lt;(https?:\\/\\/[^&]+)&gt;/g, '<a href="$1" target="_blank">$1</a>');
  s = s.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  s = s.replace(/\\*([^*]+)\\*/g, '<strong>$1</strong>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  s = s.replace(/~([^~]+)~/g, '<del>$1</del>');
  s = s.replace(/\\n/g, '<br>');
  return s;
}
function mkAvatar(uid, small) {
  var cls = small ? 'sm-avatar' : 'avatar';
  return '<div class="'+cls+'" style="background:'+avatarColor(uid)+'">'+esc(initials(userName(uid)))+'</div>';
}
function mkReactions(reactions) {
  if (!reactions || !reactions.length) return '';
  return '<div class="reactions">'+reactions.map(function(r){
    return '<span class="reaction">'+esc(r.name)+' '+r.count+'</span>';
  }).join('')+'</div>';
}
function mkThreads(replies, ts) {
  if (!replies || !replies.length) return '';
  var id = 'th_'+ts.replace('.','_');
  return '<div class="thread-toggle" data-tid="'+id+'">&#128172; '+replies.length+'件の返信</div>'+
    '<div class="thread-body" id="'+id+'" style="display:none">'+
    replies.map(function(r){
      return '<div class="thread-msg">'+mkAvatar(r.user,true)+
        '<div class="thread-content">'+
        '<div class="thread-hdr"><span class="thread-author">'+esc(userName(r.user))+'</span>'+
        '<span class="thread-time">'+formatTs(r.ts)+'</span></div>'+
        '<div class="thread-text">'+fmtText(r.text)+'</div>'+
        '</div></div>';
    }).join('')+'</div>';
}
function toggleEl(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}
function renderMessages(data) {
  var pane = document.getElementById('messages-pane');
  var msgs = data.messages || [];
  if (!msgs.length) { pane.innerHTML='<div class="placeholder">メッセージがありません</div>'; return; }
  var html = '';
  var lastDate = null;
  msgs.forEach(function(msg) {
    var dl = dateLabel(msg.ts);
    if (dl !== lastDate) {
      html += '<div class="date-sep"><div class="line"></div><div class="dlabel">'+esc(dl)+'</div><div class="line"></div></div>';
      lastDate = dl;
    }
    html += '<div class="msg">'+mkAvatar(msg.user,false)+
      '<div class="msg-body">'+
      '<div class="msg-header"><span class="msg-author">'+esc(userName(msg.user))+'</span>'+
      '<span class="msg-time">'+formatTs(msg.ts)+'</span></div>'+
      '<div class="msg-text">'+fmtText(msg.text)+'</div>'+
      mkReactions(msg.reactions)+
      mkThreads(msg.replies, msg.ts)+
      '</div></div>';
  });
  pane.innerHTML = html;
  pane.scrollTop = pane.scrollHeight;
}
function setActive(type, id) {
  document.querySelectorAll('.nav-item').forEach(function(el){ el.classList.remove('active'); });
  var el = document.querySelector('[data-type="'+type+'"][data-id="'+CSS.escape(id)+'"]');
  if (el) el.classList.add('active');
}
async function selectConv(type, id, label) {
  setActive(type, id);
  document.getElementById('main-title').textContent = (type==='channel'?'# ':'')+label;
  document.getElementById('main-meta').textContent = '';
  document.getElementById('messages-pane').innerHTML = '<div class="placeholder">読み込み中...</div>';
  var url = (type==='channel' ? '/api/messages/channel/' : '/api/messages/dm/')+encodeURIComponent(id);
  try {
    var data = await fetch(url).then(function(r){return r.json();});
    if (type==='channel' && data.channel_info) {
      var meta = [];
      if (data.channel_info.topic) meta.push(data.channel_info.topic);
      meta.push(data.messages.length+'件のメッセージ');
      document.getElementById('main-meta').textContent = meta.join(' · ');
    } else {
      document.getElementById('main-meta').textContent = (data.messages||[]).length+'件のメッセージ';
    }
    renderMessages(data);
  } catch(e) {
    document.getElementById('messages-pane').innerHTML = '<div class="placeholder">読み込みに失敗しました</div>';
  }
}
async function init() {
  users = await fetch('/api/users').then(function(r){return r.json();}).catch(function(){return {};});
  var info = await fetch('/api/info').then(function(r){return r.json();}).catch(function(){return {};});
  var dirs = info.backupDirs || [];
  var latest = (dirs[dirs.length-1]||'').replace('slack-backup-','');
  document.getElementById('backup-info').textContent = dirs.length+'件のバックアップ · 最新: '+(latest||'不明');

  var channels = await fetch('/api/channels').then(function(r){return r.json();}).catch(function(){return [];});
  document.getElementById('channels-list').innerHTML = channels.map(function(ch){
    return '<div class="nav-item" data-type="channel" data-id="'+esc(ch.name)+'" data-label="'+esc(ch.name)+'">'+
      '<span class="prefix">#</span>'+
      '<span class="label">'+(ch.is_archived?'<em>':'')+esc(ch.name)+(ch.is_archived?'</em>':'')+'</span>'+
      (ch.message_count>0?'<span class="cnt">'+ch.message_count+'</span>':'')+
      '</div>';
  }).join('');

  var dms = await fetch('/api/dms').then(function(r){return r.json();}).catch(function(){return [];});
  document.getElementById('dms-list').innerHTML = dms.map(function(dm){
    return '<div class="nav-item" data-type="dm" data-id="'+esc(dm.filename)+'" data-label="'+esc(dm.user_name)+'">'+
      '<span class="prefix">&#128100;</span>'+
      '<span class="label">'+esc(dm.user_name)+'</span>'+
      (dm.message_count>0?'<span class="cnt">'+dm.message_count+'</span>':'')+
      '</div>';
  }).join('');

  // イベント委譲：サイドバーのクリック
  document.getElementById('sidebar-body').addEventListener('click', function(e) {
    var item = e.target.closest('.nav-item');
    if (!item) return;
    selectConv(item.dataset.type, item.dataset.id, item.dataset.label || item.dataset.id);
  });

  // イベント委譲：スレッド展開ボタン
  document.getElementById('messages-pane').addEventListener('click', function(e) {
    var toggle = e.target.closest('.thread-toggle');
    if (!toggle || !toggle.dataset.tid) return;
    toggleEl(toggle.dataset.tid);
  });
}
init();
</script>
</body>
</html>`;
}

// ── HTTP サーバー ──────────────────────────────────────────────────
function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/') return send(res, 200, getHTML(), 'text/html; charset=utf-8');
  if (p === '/api/info') return send(res, 200, { backupDirs, latestDate: backupDirs.at(-1) || null });
  if (p === '/api/users') return send(res, 200, usersMap);

  if (p === '/api/channels') {
    const list = Object.entries(channelsData).map(([name, d]) => ({
      name,
      topic: d.channel_info?.topic || '',
      message_count: d.messages.length,
      is_archived: d.channel_info?.is_archived || false,
    })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return send(res, 200, list);
  }

  if (p === '/api/dms') {
    const list = Object.entries(dmsData).map(([filename, d]) => ({
      filename,
      user_name: d.dm_info?.user_name || filename,
      message_count: d.messages.length,
    })).sort((a, b) => a.user_name.localeCompare(b.user_name, 'ja'));
    return send(res, 200, list);
  }

  const chm = p.match(/^\/api\/messages\/channel\/(.+)$/);
  if (chm) {
    const name = decodeURIComponent(chm[1]);
    const d = channelsData[name];
    return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
  }

  const dmm = p.match(/^\/api\/messages\/dm\/(.+)$/);
  if (dmm) {
    const name = decodeURIComponent(dmm[1]);
    const d = dmsData[name];
    return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
  }

  send(res, 404, { error: 'not found' });
});

// ── 起動（直接実行時のみ）────────────────────────────────────────
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  loadData();
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Slack Backup Viewer: ${url}`);
    const cmd = process.platform === 'darwin' ? `open "${url}"`
      : process.platform === 'win32' ? `start "" "${url}"`
      : `xdg-open "${url}"`;
    exec(cmd, err => { if (err) console.log(`ブラウザで開いてください: ${url}`); });
  });
}

export { getHTML };
