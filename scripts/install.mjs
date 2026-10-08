import { mkdir, writeFile, cp } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const marketplace = join(dirname(root), 'multi-mail-local-marketplace');
await mkdir(join(marketplace, '.agents', 'plugins'), { recursive: true });
await cp(root, join(marketplace, 'plugins', 'multi-mail-reader'), {
  recursive: true,
  filter: source => {
    const path = relative(root, source).replaceAll('\\', '/');
    const segments = path.split('/');
    return !['.git', 'node_modules', 'coverage'].includes(segments[0])
      && !path.startsWith('.test')
      && !segments.some(name => /^\.env(?:\.|$)/.test(name) || name.endsWith('.log'));
  },
});
await writeFile(join(marketplace, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
  name: 'multi-mail-local', interface: { displayName: '本地邮箱插件' },
  plugins: [{ name: 'multi-mail-reader', source: { source: 'local', path: './plugins/multi-mail-reader' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
}, null, 2));
for (const args of [['plugin', 'marketplace', 'add', marketplace, '--json'], ['plugin', 'add', 'multi-mail-reader@multi-mail-local', '--json']]) {
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference = "Stop"; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $items = [Console]::In.ReadToEnd() | ConvertFrom-Json; & codex.cmd @items; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE'], { input: JSON.stringify(args), stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    : spawnSync('codex', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error('安装未完成，请保留插件目录并检查 Codex CLI 输出。'); process.exit(1); }
}
console.log('多邮箱收信已安装。请在 Codex 的插件配置页打开“管理邮箱”。');
