# Slack Backup Script

## 概要

Slack ワークスペースのバックアップを取るNode.jsスクリプトを作成する。

## 技術スタック

- Node.js (ESM形式, `.mjs`)
- 外部ライブラリは最小限（dotenvのみ許可、Slack SDKは使わずfetchで直接叩く）
- `package.json` と `.env.example` を含める

## 取得対象

| 対象 | API メソッド | 保存内容 |
|---|---|---|
| ユーザー一覧 | `users.list` | ID・name・real_name・display_name・is_bot |
| パブリックチャンネル一覧 | `conversations.list` (types=public_channel) | チャンネル名・トピック・purpose・作成日・アーカイブ状態 |
| チャンネルのメッセージ | `conversations.history` | 全メッセージ（テキスト・ts・発言者・リアクション等） |
| スレッド返信 | `conversations.replies` | スレッド親メッセージに紐づく全返信 |
| DM一覧 | `conversations.list` (types=im) | 相手ユーザーID |
| DMのメッセージ | `conversations.history` | 全メッセージ（同上） |
| DMのスレッド返信 | `conversations.replies` | 同上 |
| ファイル | `files.list` | メタ情報のみ（名前・タイプ・サイズ・投稿者・投稿先チャンネル・URL）。ファイル本体はダウンロードしない |

## 処理フロー

1. `SLACK_BOT_TOKEN` 環境変数の存在確認（なければエラー終了）
2. ユーザー一覧を取得 → ID→ユーザー情報のマップを作成し `users.json` に保存
3. パブリックチャンネル一覧を取得（アーカイブ済みも含む）
4. 各チャンネルについて:
   a. `conversations.history` でメッセージを全件取得（カーソルページネーション）
   b. 取得したメッセージから `thread_ts` を持つもの（スレッド親）を抽出
   c. 各スレッド親に対して `conversations.replies` で返信を全件取得
   d. 返信の1件目は親メッセージ自身なので除外する
   e. 親メッセージに `replies` フィールドとして返信配列をネストする
   f. `channels/{チャンネル名}.json` に保存
   g. Botが未参加のチャンネルは `not_in_channel` エラーをキャッチしてスキップし、サマリーに記録
5. DM一覧を取得
6. 各DMについてステップ4と同様の処理（保存先は `dms/{ユーザー名}.json`）
7. `files.list` でファイルメタ情報を全件取得（ページ番号ベースのページネーション）し `files_metadata.json` に保存
8. サマリーレポートを `summary.json` に保存

## 出力ディレクトリ構成

```
slack-backup-YYYY-MM-DD/
├── users.json
├── summary.json
├── files_metadata.json
├── channels/
│   ├── general.json
│   ├── random.json
│   └── ...
└── dms/
    ├── yamada.taro.json
    └── ...
```

## 各JSONのデータ構造

### users.json

```json
{
  "U01ABC": {
    "id": "U01ABC",
    "name": "yamada.taro",
    "real_name": "山田太郎",
    "display_name": "たろう",
    "is_bot": false
  }
}
```

### channels/{name}.json

```json
{
  "channel_info": {
    "id": "C01ABC",
    "name": "general",
    "topic": "全体チャンネル",
    "purpose": "全社連絡用",
    "created": 1600000000,
    "is_archived": false,
    "num_members": 50
  },
  "messages": [
    {
      "ts": "1713000000.000100",
      "user": "U01ABC",
      "text": "これどう思いますか？",
      "thread_ts": "1713000000.000100",
      "reply_count": 2,
      "replies": [
        { "ts": "1713000001.000200", "user": "U02DEF", "text": "いいと思います" },
        { "ts": "1713000002.000300", "user": "U03GHI", "text": "賛成です" }
      ]
    },
    {
      "ts": "1713000010.000400",
      "user": "U02DEF",
      "text": "了解です"
    }
  ]
}
```

### dms/{username}.json

```json
{
  "dm_info": {
    "id": "D01ABC",
    "user_id": "U02DEF",
    "user_name": "佐藤花子"
  },
  "messages": []
}
```

### files_metadata.json

```json
[
  {
    "id": "F01ABC",
    "name": "report.pdf",
    "title": "月次レポート",
    "filetype": "pdf",
    "size": 1048576,
    "created": 1713000000,
    "user": "U01ABC",
    "user_name": "山田太郎",
    "channels": ["C01ABC"],
    "url_private": "https://files.slack.com/..."
  }
]
```

### summary.json

```json
{
  "backup_date": "2026-04-13T12:00:00.000Z",
  "users_count": 100,
  "channels": [
    { "name": "general", "message_count": 5000 },
    { "name": "secret-proj", "message_count": 0, "error": "not_in_channel" }
  ],
  "dms": [
    { "user": "佐藤花子", "message_count": 300 }
  ],
  "files_count": 250
}
```

## API呼び出しの注意事項

### レートリミット

- 全リクエスト間に最低1.2秒のウェイトを入れること
- HTTP 429 レスポンス時は `Retry-After` ヘッダーの秒数だけ待機してリトライ
- リトライは同じ関数の再帰呼び出しでよい

### ページネーション

- `conversations.list`, `conversations.history`, `conversations.replies`, `users.list` はカーソルベース（`response_metadata.next_cursor`）
- `files.list` はページ番号ベース（`paging.pages`）
- 1リクエストあたり `limit: 200`（files.listは `count: 100`）

### エラーハンドリング

- `not_in_channel` エラー: スキップしてサマリーに記録
- その他のAPIエラー: エラーメッセージを出力してスキップ、処理は継続
- ネットワークエラー: 3回までリトライ

## 進捗表示

- 各ステップの開始時にログ出力
- チャンネル/DM名と取得メッセージ数を表示
- スレッド取得中もスレッド数の進捗を表示（スレッドが多い場合に時間がかかるため）
- 最後にサマリーを表示

## やらないこと

- Botのチャンネル自動参加（`conversations.join`は呼ばない）
- ファイル本体のダウンロード
- プライベートチャンネルの取得
- グループDMの取得
