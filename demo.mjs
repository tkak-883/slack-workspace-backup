/**
 * デモ用ビューワー。スクリーンショット撮影向けのダミーデータを表示する。
 * 起動: node demo.mjs  または  npm run demo
 */
import http from 'http';
import { exec } from 'child_process';
import { getHTML } from './viewer.mjs';

const PORT = process.env.VIEWER_PORT || 3001;

// ── デモ用ユーザー ────────────────────────────────────────────────
const USERS = {
  U001: { id: 'U001', name: 'tanaka.ichiro',  real_name: '田中一郎', display_name: '田中一郎', is_bot: false },
  U002: { id: 'U002', name: 'sato.hanako',    real_name: '佐藤花子', display_name: '佐藤花子', is_bot: false },
  U003: { id: 'U003', name: 'yamada.taro',    real_name: '山田太郎', display_name: '山田太郎', is_bot: false },
  U004: { id: 'U004', name: 'suzuki.jiro',    real_name: '鈴木次郎', display_name: '鈴木次郎', is_bot: false },
  U005: { id: 'U005', name: 'kimura.yuki',    real_name: '木村ゆき', display_name: '木村ゆき', is_bot: false },
  UBOT: { id: 'UBOT', name: 'slackbot',       real_name: 'Slackbot',  display_name: 'Slackbot',  is_bot: true  },
};

// ts(Unix秒)を生成するヘルパー
function ts(dateStr, hour = 10, min = 0, sec = 0) {
  return String(new Date(`${dateStr}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}+09:00`).getTime() / 1000);
}

// ── デモ用チャンネル ──────────────────────────────────────────────
const CHANNELS = {
  '全体連絡': {
    channel_info: { id: 'C001', name: '全体連絡', topic: '全社向けお知らせ', purpose: '全社員への連絡事項', created: 1600000000, is_archived: false, num_members: 12 },
    messages: [
      {
        ts: ts('2026-04-01', 9, 0),
        user: 'U001',
        text: 'おはようございます。4月になりました！新年度も引き続きよろしくお願いします :tada:',
        reactions: [{ name: 'tada', count: 5 }, { name: '+1', count: 4 }],
      },
      {
        ts: ts('2026-04-01', 9, 5),
        user: 'U002',
        text: 'よろしくお願いします！今期もがんばりましょう :muscle:',
        reactions: [{ name: 'muscle', count: 3 }],
      },
      {
        ts: ts('2026-04-07', 10, 0),
        user: 'U001',
        text: '【お知らせ】来週月曜（4/14）は全体MTGです。13:00〜14:00、会議室Aで行います。全員参加をお願いします。',
        thread_ts: ts('2026-04-07', 10, 0),
        reply_count: 3,
        replies: [
          { ts: ts('2026-04-07', 10, 15), user: 'U002', text: '了解しました！' },
          { ts: ts('2026-04-07', 10, 22), user: 'U003', text: '参加します :ok_hand:' },
          { ts: ts('2026-04-07', 11, 0),  user: 'U004', text: '承知しました。資料は事前に共有いただけますか？' },
        ],
        reactions: [{ name: 'eyes', count: 6 }, { name: 'ok_hand', count: 3 }],
      },
      {
        ts: ts('2026-04-10', 15, 30),
        user: 'U004',
        text: '全体MTGの資料を共有します。事前にご確認ください → <https://example.com/doc|全体MTG資料 4/14>',
        reactions: [{ name: '+1', count: 4 }],
      },
      {
        ts: ts('2026-04-13', 9, 0),
        user: 'U001',
        text: '今日もよい一日を :sunny:',
        reactions: [{ name: 'sunny', count: 7 }, { name: 'wave', count: 3 }],
      },
    ],
  },

  '開発': {
    channel_info: { id: 'C002', name: '開発', topic: '開発チームの作業ログ・相談', purpose: '技術的な議論と進捗共有', created: 1600000000, is_archived: false, num_members: 5 },
    messages: [
      {
        ts: ts('2026-04-08', 10, 0),
        user: 'U002',
        text: 'バックエンドのAPIレスポンスが遅い件、調査しました。DBのN+1クエリが原因でした。修正PRを出します。',
        thread_ts: ts('2026-04-08', 10, 0),
        reply_count: 4,
        replies: [
          { ts: ts('2026-04-08', 10, 20), user: 'U003', text: 'お疲れさまです！どのエンドポイントですか？' },
          { ts: ts('2026-04-08', 10, 25), user: 'U002', text: '`/api/projects` です。JOINで解決できそうです。' },
          { ts: ts('2026-04-08', 11, 0),  user: 'U004', text: 'レビューします！PRリンク貼ってください :eyes:' },
          { ts: ts('2026-04-08', 11, 30), user: 'U002', text: '<https://github.com/example/repo/pull/42|PR #42> 出しました。よろしくお願いします！' },
        ],
        reactions: [{ name: 'eyes', count: 2 }, { name: '+1', count: 3 }],
      },
      {
        ts: ts('2026-04-09', 14, 0),
        user: 'U003',
        text: 'デザインの修正が完了しました。ダッシュボードのグラフ部分、ご確認お願いします。',
        reactions: [{ name: 'white_check_mark', count: 2 }],
      },
      {
        ts: ts('2026-04-10', 9, 30),
        user: 'U004',
        text: '今週のスプリントゴール：\n• バックエンドAPI修正リリース\n• ダッシュボードUI改善\n• テストカバレッジ 80% 達成\n\nがんばりましょう！',
        reactions: [{ name: 'rocket', count: 4 }, { name: '+1', count: 2 }],
      },
      {
        ts: ts('2026-04-11', 16, 0),
        user: 'U002',
        text: 'PR #42 マージしました！本番デプロイは明日の朝を予定しています。',
        reactions: [{ name: 'tada', count: 3 }, { name: 'rocket', count: 2 }],
      },
      {
        ts: ts('2026-04-13', 10, 0),
        user: 'U005',
        text: 'おはようございます。今日はテストの修正に集中します :computer:',
      },
      {
        ts: ts('2026-04-13', 10, 5),
        user: 'U002',
        text: '了解です！何かあれば声かけてください :wave:',
        reactions: [{ name: 'wave', count: 1 }],
      },
    ],
  },

  '雑談': {
    channel_info: { id: 'C003', name: '雑談', topic: '仕事と関係ない話もOK！', purpose: '自由に話しましょう', created: 1600000000, is_archived: false, num_members: 10 },
    messages: [
      {
        ts: ts('2026-04-05', 12, 30),
        user: 'U003',
        text: 'お昼どこ行きました？新しいカフェが近くにオープンしてましたよ :coffee:',
        thread_ts: ts('2026-04-05', 12, 30),
        reply_count: 3,
        replies: [
          { ts: ts('2026-04-05', 12, 45), user: 'U005', text: 'どこですか！？行ってみたい！' },
          { ts: ts('2026-04-05', 12, 50), user: 'U003', text: 'ビルの隣のやつです。パスタが美味しかった :yum:' },
          { ts: ts('2026-04-05', 13, 0),  user: 'U001', text: '今度みんなでランチ行きましょう！' },
        ],
        reactions: [{ name: 'coffee', count: 5 }, { name: 'yum', count: 3 }],
      },
      {
        ts: ts('2026-04-11', 18, 0),
        user: 'U004',
        text: '週末に映画見ました。「オッペンハイマー」、すごかった…。3時間があっという間でした。',
        reactions: [{ name: 'eyes', count: 4 }, { name: 'exploding_head', count: 2 }],
      },
      {
        ts: ts('2026-04-13', 12, 0),
        user: 'U005',
        text: '今日の東京、桜がまだ少し残ってますね :cherry_blossom: お昼休みに見てきました！',
        reactions: [{ name: 'cherry_blossom', count: 6 }, { name: 'heart', count: 4 }],
      },
      {
        ts: ts('2026-04-13', 12, 10),
        user: 'U002',
        text: 'いいですね〜！写真撮ってきましたか？ :camera:',
      },
      {
        ts: ts('2026-04-13', 12, 15),
        user: 'U005',
        text: '撮りました！ (写真省略)',
        reactions: [{ name: 'heart_eyes', count: 5 }, { name: '+1', count: 3 }],
      },
    ],
  },
};

// ── デモ用DM ──────────────────────────────────────────────────────
const DMS = {
  'sato.hanako': {
    dm_info: { id: 'D001', user_id: 'U002', user_name: '佐藤花子' },
    messages: [
      { ts: ts('2026-04-10', 14, 0),  user: 'U001', text: '佐藤さん、PR #42 のレビューありがとうございました！助かりました。' },
      { ts: ts('2026-04-10', 14, 10), user: 'U002', text: 'こちらこそ！コードきれいでわかりやすかったです :+1:' },
      { ts: ts('2026-04-10', 14, 15), user: 'U001', text: '来週の全体MTG、何か発表したいことあれば枠とりますよ。' },
      { ts: ts('2026-04-10', 14, 20), user: 'U002', text: 'ありがとうございます。API改善の件を簡単に共有できればと思っています！' },
      { ts: ts('2026-04-10', 14, 22), user: 'U001', text: 'ぜひ！5分ほどお願いできますか？' },
      { ts: ts('2026-04-10', 14, 25), user: 'U002', text: '了解しました。資料準備しておきます！' },
    ],
  },
  'yamada.taro': {
    dm_info: { id: 'D002', user_id: 'U003', user_name: '山田太郎' },
    messages: [
      { ts: ts('2026-04-09', 11, 0),  user: 'U001', text: '山田さん、ダッシュボードのデザイン確認しました。いい感じです！' },
      { ts: ts('2026-04-09', 11, 5),  user: 'U003', text: 'ありがとうございます！グラフの色はフィードバックをもとに変えてみました。' },
      { ts: ts('2026-04-09', 11, 10), user: 'U001', text: '見やすくなりましたね。このままいきましょう！' },
      { ts: ts('2026-04-12', 16, 0),  user: 'U003', text: '来週の資料デザインのたたきを作ったので確認お願いできますか？' },
      { ts: ts('2026-04-12', 16, 30), user: 'U001', text: '確認します！明日の午前中でいいですか？' },
      { ts: ts('2026-04-12', 16, 35), user: 'U003', text: '全然大丈夫です。よろしくお願いします！' },
    ],
  },
};

// ── HTTP サーバー ──────────────────────────────────────────────────
function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/') return send(res, 200, getHTML(), 'text/html; charset=utf-8');

  if (p === '/api/info') return send(res, 200, {
    backupDirs: ['slack-backup-2026-04-13'],
    latestDate: 'slack-backup-2026-04-13',
  });

  if (p === '/api/users') return send(res, 200, USERS);

  if (p === '/api/channels') {
    const list = Object.entries(CHANNELS).map(([name, d]) => ({
      name,
      topic: d.channel_info.topic,
      message_count: d.messages.length,
      is_archived: false,
    }));
    return send(res, 200, list);
  }

  if (p === '/api/dms') {
    const list = Object.entries(DMS).map(([filename, d]) => ({
      filename,
      user_name: d.dm_info.user_name,
      message_count: d.messages.length,
    }));
    return send(res, 200, list);
  }

  const chm = p.match(/^\/api\/messages\/channel\/(.+)$/);
  if (chm) {
    const name = decodeURIComponent(chm[1]);
    const d = CHANNELS[name];
    return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
  }

  const dmm = p.match(/^\/api\/messages\/dm\/(.+)$/);
  if (dmm) {
    const name = decodeURIComponent(dmm[1]);
    const d = DMS[name];
    return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Slack Backup Demo: ${url}`);
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log(`ブラウザで開いてください: ${url}`); });
});
