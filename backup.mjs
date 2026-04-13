import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.SLACK_BOT_TOKEN;
if (!TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN environment variable is not set.');
  process.exit(1);
}

const USER_TOKEN = process.env.SLACK_USER_TOKEN || TOKEN;

const RATE_LIMIT_DELAY = 1200; // ms
const MAX_RETRIES = 3;

const today = new Date().toISOString().slice(0, 10);
const OUTPUT_DIR = `slack-backup-${today}`;

// ── ディレクトリ作成 ──────────────────────────────────────────────
fs.mkdirSync(path.join(OUTPUT_DIR, 'channels'), { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, 'dms'), { recursive: true });

// ── ユーティリティ ────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function slackRequest(method, params = {}, retryCount = 0, token = TOKEN) {
  await sleep(RATE_LIMIT_DELAY);

  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`  Network error (retry ${retryCount + 1}/${MAX_RETRIES}): ${err.message}`);
      return slackRequest(method, params, retryCount + 1, token);
    }
    throw err;
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    console.warn(`  Rate limited. Waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return slackRequest(method, params, retryCount, token);
  }

  const data = await res.json();
  return data;
}

// カーソルページネーションで全件取得
async function fetchAllCursor(method, params, dataKey, token = TOKEN) {
  const results = [];
  let cursor = undefined;

  while (true) {
    const reqParams = { limit: 200, ...params };
    if (cursor) reqParams.cursor = cursor;

    const data = await slackRequest(method, reqParams, 0, token);

    if (!data.ok) {
      throw Object.assign(new Error(data.error), { slackError: data.error });
    }

    results.push(...(data[dataKey] || []));

    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return results;
}

// ── 1. ユーザー一覧 ───────────────────────────────────────────────
async function fetchUsers() {
  console.log('Fetching users...');
  const members = await fetchAllCursor('users.list', {}, 'members');

  const usersMap = {};
  for (const m of members) {
    usersMap[m.id] = {
      id: m.id,
      name: m.name,
      real_name: m.real_name || '',
      display_name: m.profile?.display_name || '',
      is_bot: m.is_bot || false,
    };
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'users.json'),
    JSON.stringify(usersMap, null, 2)
  );
  console.log(`  Saved ${Object.keys(usersMap).length} users.`);
  return usersMap;
}

// ── 2. メッセージ + スレッド取得 ──────────────────────────────────
async function fetchMessagesWithThreads(channelId, token = TOKEN) {
  const messages = await fetchAllCursor(
    'conversations.history',
    { channel: channelId },
    'messages',
    token
  );

  // スレッド親（thread_ts == ts かつ reply_count > 0）を抽出
  const threadParents = messages.filter(
    m => m.thread_ts === m.ts && (m.reply_count || 0) > 0
  );

  if (threadParents.length > 0) {
    console.log(`    Fetching ${threadParents.length} threads...`);
    let done = 0;
    for (const parent of threadParents) {
      const replies = await fetchAllCursor(
        'conversations.replies',
        { channel: channelId, ts: parent.thread_ts },
        'messages',
        token
      );
      // 1件目は親メッセージ自身なので除外
      parent.replies = replies.slice(1).map(r => ({
        ts: r.ts,
        user: r.user,
        text: r.text,
        ...(r.reactions ? { reactions: r.reactions } : {}),
      }));
      done++;
      if (done % 10 === 0 || done === threadParents.length) {
        process.stdout.write(`\r    Threads: ${done}/${threadParents.length}`);
      }
    }
    console.log();
  }

  return messages;
}

// ── 3. パブリックチャンネル ───────────────────────────────────────
async function backupChannels(summary) {
  console.log('\nFetching public channels...');
  const channels = await fetchAllCursor(
    'conversations.list',
    { types: 'public_channel', exclude_archived: false },
    'channels'
  );
  console.log(`  Found ${channels.length} channels.`);

  for (const ch of channels) {
    console.log(`\nChannel: #${ch.name}`);
    let messages = [];
    let error = null;

    try {
      messages = await fetchMessagesWithThreads(ch.id);
    } catch (err) {
      error = err.slackError || err.message;
      if (error === 'not_in_channel') {
        console.log(`  Skipped: bot is not in channel.`);
      } else {
        console.error(`  Error: ${error}`);
      }
    }

    const channelData = {
      channel_info: {
        id: ch.id,
        name: ch.name,
        topic: ch.topic?.value || '',
        purpose: ch.purpose?.value || '',
        created: ch.created,
        is_archived: ch.is_archived || false,
        num_members: ch.num_members || 0,
      },
      messages,
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'channels', `${ch.name}.json`),
      JSON.stringify(channelData, null, 2)
    );

    const entry = { name: ch.name, message_count: messages.length };
    if (error) entry.error = error;
    summary.channels.push(entry);

    if (!error) {
      console.log(`  Saved ${messages.length} messages.`);
    }
  }
}

// ── 4. DM ─────────────────────────────────────────────────────────
async function backupDMs(usersMap, summary) {
  console.log('\nFetching DMs...');
  const dms = await fetchAllCursor(
    'conversations.list',
    { types: 'im' },
    'channels',
    USER_TOKEN
  );
  console.log(`  Found ${dms.length} DMs.`);

  for (const dm of dms) {
    const userId = dm.user;
    const userInfo = usersMap[userId];
    const userName = userInfo?.name || userId;
    const displayName = userInfo?.real_name || userInfo?.name || userId;

    console.log(`\nDM: ${displayName}`);
    let messages = [];
    let error = null;

    try {
      messages = await fetchMessagesWithThreads(dm.id, USER_TOKEN);
    } catch (err) {
      error = err.slackError || err.message;
      console.error(`  Error: ${error}`);
    }

    const dmData = {
      dm_info: {
        id: dm.id,
        user_id: userId,
        user_name: displayName,
      },
      messages,
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'dms', `${userName}.json`),
      JSON.stringify(dmData, null, 2)
    );

    const entry = { user: displayName, message_count: messages.length };
    if (error) entry.error = error;
    summary.dms.push(entry);

    if (!error) {
      console.log(`  Saved ${messages.length} messages.`);
    }
  }
}

// ── 5. ファイルメタ情報 ───────────────────────────────────────────
async function backupFiles(usersMap, summary) {
  console.log('\nFetching files metadata...');
  const allFiles = [];
  let page = 1;

  while (true) {
    await sleep(RATE_LIMIT_DELAY);
    const data = await slackRequest('files.list', { count: 100, page });

    if (!data.ok) {
      console.error(`  files.list error: ${data.error}`);
      break;
    }

    allFiles.push(...(data.files || []));

    const totalPages = data.paging?.pages || 1;
    console.log(`  Page ${page}/${totalPages} (${allFiles.length} files so far)`);

    if (page >= totalPages) break;
    page++;
  }

  const filesData = allFiles.map(f => ({
    id: f.id,
    name: f.name,
    title: f.title,
    filetype: f.filetype,
    size: f.size,
    created: f.created,
    user: f.user,
    user_name: usersMap[f.user]?.real_name || usersMap[f.user]?.name || f.user,
    channels: f.channels || [],
    url_private: f.url_private || '',
  }));

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'files_metadata.json'),
    JSON.stringify(filesData, null, 2)
  );

  summary.files_count = filesData.length;
  console.log(`  Saved metadata for ${filesData.length} files.`);
}

// ── メイン ────────────────────────────────────────────────────────
async function main() {
  console.log(`Starting Slack backup → ${OUTPUT_DIR}/\n`);

  const summary = {
    backup_date: new Date().toISOString(),
    users_count: 0,
    channels: [],
    dms: [],
    files_count: 0,
  };

  const usersMap = await fetchUsers();
  summary.users_count = Object.keys(usersMap).length;

  await backupChannels(summary);
  await backupDMs(usersMap, summary);
  await backupFiles(usersMap, summary);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('\n=== Backup Complete ===');
  console.log(`  Users   : ${summary.users_count}`);
  console.log(`  Channels: ${summary.channels.length} (${summary.channels.filter(c => c.error).length} skipped)`);
  console.log(`  DMs     : ${summary.dms.length}`);
  console.log(`  Files   : ${summary.files_count}`);
  console.log(`  Output  : ${path.resolve(OUTPUT_DIR)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
