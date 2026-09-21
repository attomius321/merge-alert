import { execFile } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000 }, (err) => resolve(!err));
  });
}

const PS_TOAST = `
$ErrorActionPreference='Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$n=$t.GetElementsByTagName('text')
$n.Item(0).AppendChild($t.CreateTextNode($env:MA_TITLE)) | Out-Null
$n.Item(1).AppendChild($t.CreateTextNode($env:MA_BODY)) | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('MergeAlert').Show([Windows.UI.Notifications.ToastNotification]::new($t))
`;

function powershellToast(title, body) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_TOAST],
      { timeout: 20_000, env: { ...process.env, MA_TITLE: title, MA_BODY: body } },
      (err) => resolve(!err),
    );
  });
}

/**
 * Desktop notification, best effort: native Linux first, then the WSL bridges,
 * then the terminal. Never throws - a missing notifier must not kill the watcher.
 */
export async function notify(title, body) {
  const attempts = [
    () => run('notify-send', ['--app-name=MergeAlert', '--icon=dialog-information', title, body]),
    () => run('wsl-notify-send.exe', [`--category=MergeAlert`, `${title}: ${body}`]),
    () => powershellToast(title, body),
  ];

  for (const attempt of attempts) {
    try {
      if (await attempt()) return true;
    } catch { /* try the next one */ }
  }
  console.log(`[notify] ${title} - ${body}`);
  return false;
}
