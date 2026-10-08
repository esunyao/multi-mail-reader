import { createServer } from 'node:http';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const testBase = join(root, '..', '..', 'work', 'test-data');
await mkdir(testBase, { recursive: true });
const data = await mkdtemp(join(testBase, 'ui-'));
const token = randomUUID();
const client = new Client({ name: 'settings-test-host', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist', 'server.cjs'), '--data-dir', data], stderr: 'pipe' });
transport.stderr?.resume();
await client.connect(transport);
const host = await build({ stdin: { contents: `
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const iframe = document.createElement('iframe');
iframe.title = '邮箱配置'; iframe.style.cssText = 'width:100%;height:100vh;border:0;display:block';
document.body.appendChild(iframe);
const bridge = new AppBridge(null, {name:'settings-test-host',version:'1.0.0'}, {serverTools:{},logging:{}}, {hostContext:{theme:'light',displayMode:'fullscreen'}});
bridge.oncalltool = async params => (await fetch('/tool', {method:'POST',headers:{'content-type':'application/json','x-test-token':${JSON.stringify(token)}},body:JSON.stringify(params)})).json();
bridge.oninitialized = async () => { await bridge.sendToolInput({arguments:{}}); await bridge.sendToolResult(await bridge.oncalltool({name:'manage_accounts',arguments:{}},{})); };
await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
iframe.src = '/accounts.html';
window.testBridge = bridge;
`, resolveDir: root }, bundle: true, platform: 'browser', format: 'esm', write: false });
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/tool' && request.method === 'POST') {
      if (request.headers['x-test-token'] !== token) { response.writeHead(403).end(); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!args.name.startsWith('accounts_') && args.name !== 'manage_accounts') { response.writeHead(403).end(); return; }
      const result = await client.callTool(args);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result)); return;
    }
    if (request.url === '/accounts.html') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(join(root, 'dist', 'accounts.html'))); return; }
    if (request.url === '/host.js') { response.writeHead(200, { 'content-type': 'text/javascript' }).end(host.outputFiles[0].text); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><script type="module" src="/host.js"></script></body></html>');
  } catch { response.writeHead(500).end('Test host error'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const errors = [];
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 1100 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: '添加邮箱' }).click();
  await frame.getByLabel('邮箱名称', { exact: true }).fill('学校邮箱');
  await frame.getByLabel('邮箱地址', { exact: true }).fill('student@example.edu');
  await frame.locator('#imapHost').fill('imap.exmail.qq.com');
  await frame.locator('#imapPassword').fill('NotARealCredential-UI-123');
  assert.equal(await frame.locator('#imapUsername').inputValue(), 'student@example.edu');
  await frame.locator('#smtpEnabled').check();
  await frame.locator('#smtpHost').fill('smtp.exmail.qq.com');
  await frame.locator('#smtpReuse').uncheck();
  await frame.locator('#smtpUsername').fill('smtp-user');
  await frame.locator('#smtpPassword').fill('NotARealSMTP-123');
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.getByText('邮箱已保存', { exact: true }).waitFor({ timeout: 60000 });
  await frame.getByRole('button', { name: '添加邮箱' }).click();
  await frame.locator('#name').fill('工作邮箱'); await frame.locator('#email').fill('work@example.com');
  await frame.locator('#imapHost').fill('imap.example.com'); await frame.locator('#imapPassword').fill('NotARealWorkCredential');
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.getByText('邮箱已保存', { exact: true }).waitFor({ timeout: 60000 });
  await frame.getByRole('button', { name: '设为默认邮箱 工作邮箱', exact: true }).click();
  await frame.getByText('默认邮箱已更新', { exact: true }).waitFor();
  const screenshots = join(root, '..', '..', 'work', 'screenshots'); await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, 'accounts-desktop.png'), fullPage: true });
  await frame.getByRole('button', { name: '编辑邮箱 学校邮箱', exact: true }).click();
  assert.equal(await frame.locator('#imapPassword').inputValue(), ''); assert.equal(await frame.locator('#smtpPassword').inputValue(), '');
  assert.equal(await frame.locator('#smtpUsername').inputValue(), 'smtp-user');
  await page.screenshot({ path: join(screenshots, 'settings-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(screenshots, 'settings-mobile.png'), fullPage: true });
  assert.equal(await frame.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
  await frame.locator('#name').fill('学校邮箱已更新');
  await frame.locator('#imapHost').fill('localhost'); await frame.locator('#imapPort').fill('1');
  await frame.getByRole('button', { name: '保存并测试', exact: true }).click();
  await frame.locator('#notice').filter({ hasText: '配置已保存。' }).waitFor({ timeout: 60000 });
  assert.equal(await frame.locator('#imapPassword').inputValue(), '');
  await frame.getByRole('button', { name: '返回邮箱列表', exact: true }).click();
  await frame.getByRole('button', { name: '编辑邮箱 学校邮箱已更新', exact: true }).click();
  await frame.getByRole('button', { name: '删除邮箱配置', exact: true }).click();
  await frame.getByRole('button', { name: '删除配置', exact: true }).click();
  await frame.getByText('邮箱配置已删除', { exact: true }).waitFor();
  const accounts = (await client.callTool({ name: 'list_accounts', arguments: {} })).structuredContent.accounts;
  assert.equal(accounts.length, 1); assert.equal(accounts[0].email, 'work@example.com');
  assert.equal(accounts[0].isDefault, true);
  assert.deepEqual(errors, []);
  console.log('Settings UI: add two accounts, SMTP credentials, edit with blank password, default, delete, desktop/mobile layout passed.');
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { console.error('Browser errors:', errors); console.error('Settings text:', (await page.frameLocator('iframe').locator('main').innerText()).slice(0, 3000)); }
  throw error;
} finally {
  await browser?.close(); await client.close(); await new Promise(resolve => server.close(resolve));
}
