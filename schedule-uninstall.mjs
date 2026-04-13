import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platform = process.platform;

if (platform === 'darwin') {
  const label = 'com.slack-backup';
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {}
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
    console.log(`削除しました: ${plistPath}`);
  } else {
    console.log('スケジュールは登録されていません。');
  }

} else if (platform === 'win32') {
  const taskName = 'SlackWorkspaceBackup';
  try {
    execSync(`schtasks /delete /tn "${taskName}" /f`);
    console.log(`タスク "${taskName}" を削除しました。`);
  } catch {
    console.log('スケジュールは登録されていません。');
  }
  const batPath = path.join(__dirname, '_backup-run.bat');
  if (fs.existsSync(batPath)) fs.unlinkSync(batPath);

} else {
  const MARKER = '# slack-workspace-backup';
  let existing = '';
  try { existing = execSync('crontab -l', { encoding: 'utf8' }); } catch {}
  const filtered = existing.split('\n').filter(l => !l.includes(MARKER)).join('\n').trimEnd();
  const tmpFile = path.join(os.tmpdir(), 'slack-backup-crontab.tmp');
  fs.writeFileSync(tmpFile, filtered ? filtered + '\n' : '');
  execSync(`crontab "${tmpFile}"`);
  fs.unlinkSync(tmpFile);
  console.log('crontab からエントリを削除しました。');
}
