import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AccountStore } from '../src/store.js';
import { WindowsDpapi } from '../src/crypto.js';
import { account, temporaryStore, testProtector } from './fixtures.js';

test('multiple accounts persist, retain passwords, switch default, and preserve SMTP', async () => {
  const store = await temporaryStore();
  const first = await store.save({ ...account(993), smtp: { host: 'smtp.example.com', port: 465, reuseImapCredentials: false, username: 'smtp-user', password: 'smtp-test-secret' } });
  const second = await store.save(account(994, { name: '另一个邮箱', email: 'other@example.com' }));
  assert.equal(first.isDefault, true);
  const saved = await store.save({ ...account(993, { id: first.id, name: '改名' }), imap: { host: 'localhost', port: 993, username: 'testuser', password: '' }, smtp: { host: 'smtp.example.com', port: 465, reuseImapCredentials: false, username: 'smtp-user', password: '' } });
  assert.equal((await store.credentials(first.id)).password, 'testpass');
  assert.equal(saved.smtp?.hasPassword, true);
  const restarted = new AccountStore(store.directory, testProtector);
  assert.equal((await restarted.list()).length, 2);
  await restarted.setDefault(second.id);
  assert.equal((await restarted.get()).id, second.id);
  await restarted.remove(second.id);
  assert.equal((await restarted.get()).id, first.id);
  const publicJson = JSON.stringify(await restarted.list());
  assert.ok(!publicJson.includes('Cipher') && !publicJson.includes('smtp-test-secret') && !publicJson.includes('testpass'));
  const disk = await readFile(join(store.directory, 'accounts.json'), 'utf8');
  assert.ok(!disk.includes('testpass') && !disk.includes('smtp-test-secret'));
});

test('concurrent stores do not overwrite each other', async () => {
  const first = await temporaryStore();
  const second = new AccountStore(first.directory, testProtector);
  await Promise.all([first.save(account(993)), second.save(account(994, { email: 'second@example.com' }))]);
  assert.equal((await first.list()).length, 2);
  assert.equal((await first.list()).filter(a => a.isDefault).length, 1);
});

test('new accounts require a password and reject malformed SMTP', async () => {
  const store = await temporaryStore();
  await assert.rejects(store.save({ ...account(993), imap: { ...account(993).imap, password: '' } }), /密码/);
  await assert.rejects(store.save({ ...account(993), smtp: { host: 'smtp.example.com', port: 465, reuseImapCredentials: false } }), /用户名/);
  assert.equal((await store.list()).length, 0);
});

test('Windows DPAPI roundtrip persists across instances without plaintext', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const crypto = new WindowsDpapi();
  const password = '测试授权码-NotARealCredential-123!';
  const encrypted = await crypto.protect(password);
  assert.ok(!encrypted.includes(password));
  assert.equal(await new WindowsDpapi().unprotect(encrypted), password);
  const changed = Buffer.from(encrypted, 'base64'); changed[changed.length - 1] ^= 255;
  await assert.rejects(crypto.unprotect(changed.toString('base64')), /无法处理/);
});
