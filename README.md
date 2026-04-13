# slack-workspace-backup

Slack ワークスペースのメッセージをローカルに保存し、Slack 風 UI でブラウザから閲覧できるツールです。

## 機能

- パブリックチャンネルのメッセージ・スレッドを全件取得
- DM（ダイレクトメッセージ）のメッセージ・スレッドを全件取得
- ファイルのメタ情報を取得（本体はダウンロードしない）
- 複数回のバックアップを自動マージ（同一メッセージは最新版を表示）
- Slack 風 UI でブラウザ閲覧
- macOS / Windows / Linux 向け月次自動バックアップのスケジュール登録

## スクリーンショット



## 必要なもの

- Node.js 18 以上
- Slack Bot Token（`xoxb-`）および User OAuth Token（`xoxp-`）

## セットアップ

### 1. Slack アプリの作成

[api.slack.com/apps](https://api.slack.com/apps) でアプリを作成し、以下のスコープを付与してください。

| スコープ | 種別 | 用途 |
|---|---|---|
| `channels:history` | Bot + User | チャンネルの履歴取得 |
| `channels:read` | Bot + User | チャンネル一覧取得 |
| `im:history` | Bot + User | DM の履歴取得 |
| `im:read` | Bot + User | DM 一覧取得 |
| `users:read` | Bot + User | ユーザー一覧取得 |
| `files:read` | Bot + User | ファイル一覧取得 |

> **注意**: DM を取得するには **User Token Scopes**（Bot Token Scopes とは別の欄）への追加が必要です。

**OAuth & Permissions** ページで「Install to Workspace」を実行し、以下の 2 つのトークンを取得してください。
- **Bot OAuth Token** (`xoxb-...`)
- **User OAuth Token** (`xoxp-...`)

### 2. インストール

```bash
git clone https://github.com/your-username/slack-workspace-backup.git
cd slack-workspace-backup
npm install
```

### 3. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集してトークンを設定します。

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_USER_TOKEN=xoxp-your-user-token-here
```

## 使い方

### バックアップを実行する

```bash
npm start
```

`slack-backup-YYYY-MM-DD/` ディレクトリに保存されます。

```
slack-backup-2026-04-13/
├── users.json
├── summary.json
├── files_metadata.json
├── channels/
│   ├── general.json
│   └── ...
└── dms/
    ├── yamada.taro.json
    └── ...
```

### ブラウザで閲覧する

```bash
npm run view
```

ブラウザが自動的に開きます（`http://localhost:3000`）。

- 複数回のバックアップが存在する場合、自動的にマージして最新状態を表示します
- 同一メッセージが複数バックアップに存在する場合、新しい方（編集済みメッセージ等）を優先します

ポートを変更したい場合:

```bash
VIEWER_PORT=4000 npm run view
```

### 月次自動バックアップを設定する

```bash
npm run schedule
```

毎週月曜 02:00 に自動実行されるよう登録されます。

| OS | 使用ツール | 備考 |
|---|---|---|
| macOS | launchd | スリープ復帰時にも実行 |
| Windows | Task Scheduler | 管理者権限不要 |
| Linux | crontab | — |

テスト用に短い間隔で実行したい場合:

```bash
npm run schedule:test   # 60秒ごと
npm run unschedule      # 解除
```

ログは `backup.log` / `backup-error.log` に保存されます。

## レートリミットについて

Slack API の制限に従い、以下の対策を実装しています。

- リクエスト間に 1.2 秒のウェイト
- HTTP 429 時は `Retry-After` ヘッダーの秒数だけ待機してリトライ
- ネットワークエラーは最大 3 回リトライ

## 技術スタック

- Node.js（ESM / `.mjs`）
- 外部ライブラリ: `dotenv` のみ
- Slack SDK 不使用（`fetch` で直接 API を呼び出し）

## ライセンス

MIT
