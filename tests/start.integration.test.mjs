import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readSource } from '../scripts/start.mjs';

test('clean Git source auto-builds once, exposes settings and read tools, then starts offline', { timeout: 600000 }, async context => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const base = join(root, '..', '..', 'work', 'test-data');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'cold-start-'));
  const source = join(directory, 'source with spaces');
  const cacheRoot = join(directory, 'runtime cache');
  const accountDirectory = join(directory, 'empty accounts');
  for (const [path, bytes] of (await readSource(root)).files) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), bytes);
  }
  const clients = [];
  let diagnostics = '';
  const connect = async offline => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [join(source, 'scripts/start.mjs'), '--data-dir', accountDirectory], stderr: 'pipe',
      env: { ...getDefaultEnvironment(), MULTI_MAIL_RUNTIME_DIR: cacheRoot,
        ...(offline ? { npm_config_offline: 'true', npm_config_registry: 'https://127.0.0.1:1' } : {}) },
    });
    transport.stderr?.on('data', bytes => { diagnostics += bytes; });
    const client = new Client({ name: 'git-startup-test', version: '1.0.0' });
    clients.push(client);
    try {
      await client.connect(transport, { timeout: 600000 });
    } catch (error) {
      throw new Error(`Startup failed: ${error.message}\n${diagnostics.slice(-12000)}`, { cause: error });
    }
    return client;
  };
  context.after(async () => { await Promise.allSettled(clients.map(client => client.close())); });
  const [first, concurrent] = await Promise.all([connect(false), connect(false)]);
  assert.equal(first.getServerVersion().version, '0.1.1');
  assert.equal((diagnostics.match(/installing locked dependencies/g) ?? []).length, 1);
  for (const client of [first, concurrent]) {
    const tools = (await client.listTools()).tools;
    for (const name of ['list_accounts', 'list_folders', 'search_messages', 'read_message', 'read_attachment', 'manage_accounts']) assert.ok(tools.some(tool => tool.name === name));
    const result = await client.callTool({ name: 'list_accounts', arguments: {} });
    assert.deepEqual(result.structuredContent.accounts, []);
    const resource = await client.readResource({ uri: 'ui://multi-mail-reader/accounts.html' });
    assert.ok(resource.contents[0].text.includes('smtpEnabled'));
    const capabilities = client.getServerCapabilities();
    const settings = capabilities.extensions?.['openai/settings'] ?? capabilities.experimental?.['openai/settings'];
    const layout = await client.callTool({ name: settings.readTool, arguments: {} });
    assert.equal(layout.structuredContent.layout[0].items[0].tool, 'manage_accounts');
  }
  await Promise.all([first.close(), concurrent.close()]);
  diagnostics = '';
  const warm = await connect(true);
  assert.deepEqual((await warm.callTool({ name: 'list_accounts', arguments: {} })).structuredContent.accounts, []);
  assert.equal(diagnostics, '');
  await assert.rejects(readFile(join(source, 'dist/server.cjs')), { code: 'ENOENT' });
  await assert.rejects(readdir(join(source, 'node_modules')), { code: 'ENOENT' });
  const [fingerprint] = await readdir(cacheRoot);
  await assert.rejects(readdir(join(cacheRoot, fingerprint, 'node_modules')), { code: 'ENOENT' });
  assert.ok(!diagnostics.includes('password'));
});
