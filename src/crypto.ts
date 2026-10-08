import { spawn } from 'node:child_process';

export interface SecretProtector { protect(value: string): Promise<string>; unprotect(value: string): Promise<string> }

// Only the operation and encrypted/base64 payload travel over stdin, never command-line arguments.
const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$bytes = [Convert]::FromBase64String($request.data)
$entropy = [Text.Encoding]::UTF8.GetBytes('multi-mail-reader/v1')
if ($request.operation -eq 'protect') {
  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} elseif ($request.operation -eq 'unprotect') {
  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else { throw 'Invalid operation' }
[Console]::Out.Write([Convert]::ToBase64String($result))
`;

export class WindowsDpapi implements SecretProtector {
  private async run(operation: 'protect' | 'unprotect', data: string): Promise<string> {
    if (process.platform !== 'win32') throw new Error('此插件的密码存储需要 Windows 当前用户加密服务。');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('密码加密服务超时。')); }, 20000);
      child.stdout.on('data', chunk => { output += chunk.toString('ascii'); });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 Windows 密码加密服务。')); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(output.trim())) reject(new Error('无法处理保存的密码，请使用原 Windows 用户或重新输入密码。'));
        else resolve(output.trim());
      });
      child.stdin.end(JSON.stringify({ operation, data }));
    });
  }
  async protect(value: string) { return this.run('protect', Buffer.from(value, 'utf8').toString('base64')); }
  async unprotect(value: string) { return Buffer.from(await this.run('unprotect', value), 'base64').toString('utf8'); }
}
