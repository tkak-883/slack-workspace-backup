/**
 * backup.mjs を自動実行するスケジュールを登録する。
 *   通常:  毎週月曜 02:00
 *   テスト: node schedule-install.mjs --interval 60  (60秒ごと)
 *
 * macOS  : launchd (~/Library/LaunchAgents/)
 * Windows: Task Scheduler (schtasks)
 * Linux  : crontab
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodePath = process.execPath;
const scriptPath = path.join(__dirname, 'backup.mjs');
const platform = process.platform;

// --interval <秒> が指定されたらその間隔で実行（テスト用）
const intervalIdx = process.argv.indexOf('--interval');
const intervalSec = intervalIdx !== -1 ? parseInt(process.argv[intervalIdx + 1], 10) : null;
const isTest = intervalSec !== null && intervalSec > 0;

console.log(`Platform: ${platform}`);
console.log(`Node    : ${nodePath}`);
console.log(`Script  : ${scriptPath}`);
if (isTest) console.log(`Mode    : テスト (${intervalSec}秒ごと)`);
console.log();

// ── macOS ──────────────────────────────────────────────────────────
if (platform === 'darwin') {
  const label = 'com.slack-backup';
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, `${label}.plist`);

  fs.mkdirSync(plistDir, { recursive: true });

  // テスト時は StartInterval（秒単位）、通常は StartCalendarInterval（毎月1日 02:00）
  // Weekday: 1=月曜
  const scheduleXml = isTest
    ? `  <key>StartInterval</key>\n  <integer>${intervalSec}</integer>`
    : `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Weekday</key><integer>1</integer>\n    <key>Hour</key>  <integer>2</integer>\n    <key>Minute</key><integer>0</integer>\n  </dict>`;

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
${scheduleXml}
  <key>WorkingDirectory</key>
  <string>${__dirname}</string>
  <key>StandardOutPath</key>
  <string>${path.join(__dirname, 'backup.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(__dirname, 'backup-error.log')}</string>
</dict>
</plist>`;

  // 既存エントリをアンロード
  try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'ignore' }); } catch {}

  fs.writeFileSync(plistPath, plist);
  execSync(`launchctl load "${plistPath}"`);

  const schedDesc = isTest ? `${intervalSec}秒ごと` : '毎週月曜 02:00';
  console.log('✔ スケジュール登録完了 (macOS launchd)');
  console.log(`  実行タイミング: ${schedDesc}`);
  console.log(`  Plist : ${plistPath}`);
  console.log(`  ログ  : ${path.join(__dirname, 'backup.log')}`);
  console.log();
  console.log('削除するには:');
  console.log(`  node schedule-uninstall.mjs`);
  console.log('または:');
  console.log(`  launchctl unload "${plistPath}" && rm "${plistPath}"`);

// ── Windows ───────────────────────────────────────────────────────
} else if (platform === 'win32') {
  const taskName = 'SlackWorkspaceBackup';
  const batPath = path.join(__dirname, '_backup-run.bat');

  // バッチファイル作成
  fs.writeFileSync(batPath,
    `@echo off\r\ncd /d "${__dirname}"\r\n"${nodePath}" "${scriptPath}" >> "${path.join(__dirname, 'backup.log')}" 2>&1\r\n`
  );

  // 既存タスク削除
  try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore' }); } catch {}

  // スケジュール登録
  try {
    const schedArgs = isTest
      ? `/sc minute /mo ${intervalSec < 60 ? 1 : Math.round(intervalSec / 60)}`
      : `/sc weekly /d MON /st 02:00`;
    execSync(`schtasks /create /tn "${taskName}" /tr "${batPath}" ${schedArgs} /ru "" /f`);
    const schedDesc = isTest ? `${intervalSec}秒ごと` : '毎週月曜 02:00';
    console.log('✔ スケジュール登録完了 (Windows Task Scheduler)');
    console.log(`  実行タイミング: ${schedDesc}`);
    console.log(`  タスク名: ${taskName}`);
    console.log(`  バッチ  : ${batPath}`);
    console.log(`  ログ    : ${path.join(__dirname, 'backup.log')}`);
    console.log();
    console.log('削除するには:');
    console.log(`  schtasks /delete /tn "${taskName}" /f`);
  } catch (err) {
    console.error('エラー: タスクの登録に失敗しました。');
    console.error('管理者権限でコマンドプロンプトを開いて再実行してください。');
    console.error(err.message);
    process.exit(1);
  }

// ── Linux ─────────────────────────────────────────────────────────
} else {
  const MARKER = '# slack-workspace-backup';
  const cronSchedule = isTest
    ? `*/${Math.max(1, Math.round(intervalSec / 60))} * * * *`
    : `0 2 * * 1`; // 毎週月曜 02:00
  const cronLine = `${cronSchedule} cd "${__dirname}" && "${nodePath}" "${scriptPath}" >> "${path.join(__dirname, 'backup.log')}" 2>&1 ${MARKER}`;

  let existing = '';
  try { existing = execSync('crontab -l', { encoding: 'utf8' }); } catch {}

  // 既存エントリを除去して追加
  const filtered = existing.split('\n').filter(l => !l.includes(MARKER)).join('\n').trimEnd();
  const newCrontab = (filtered ? filtered + '\n' : '') + cronLine + '\n';

  const tmpFile = path.join(os.tmpdir(), 'slack-backup-crontab.tmp');
  fs.writeFileSync(tmpFile, newCrontab);
  try {
    execSync(`crontab "${tmpFile}"`);
    fs.unlinkSync(tmpFile);
    const schedDesc = isTest ? `${intervalSec}秒ごと` : '毎週月曜 02:00';
    console.log('✔ スケジュール登録完了 (crontab)');
    console.log(`  実行タイミング: ${schedDesc}`);
    console.log(`  Cron: ${cronLine}`);
    console.log();
    console.log('削除するには: crontab -e で該当行を削除');
  } catch (err) {
    fs.unlinkSync(tmpFile);
    console.error('エラー:', err.message);
    process.exit(1);
  }
}
