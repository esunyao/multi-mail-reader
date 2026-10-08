import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const utf8 = new TextDecoder('utf-8', { fatal: true });
let checked = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(root, path).replaceAll('\\', '/');
    if (rel === '.git' || rel === 'node_modules' || rel === 'dist/node_modules') continue;
    if (entry.isDirectory()) await walk(path);
    else if (/\.(ts|mjs|cjs|json|md|html|css|svg)$/.test(entry.name)) { utf8.decode(await readFile(path)); checked++; }
  }
}
await walk(root);
const manifest = JSON.parse(await readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
await assert.rejects(readFile(join(root, 'plugin.json')), { code: 'ENOENT' });
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
assert.equal(packageInfo.version, manifest.version); assert.equal(lock.version, manifest.version); assert.equal(lock.packages[''].version, manifest.version);
const nativeMcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
const portableMcp = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8'));
assert.equal(nativeMcp.mcpServers.mail.startup_timeout_sec, 600);
assert.equal(nativeMcp.mcpServers.mail.args[0], 'scripts/start.mjs');
assert.equal(nativeMcp.mcpServers.mail.cwd, '.');
assert.ok(portableMcp.mcpServers.mail.args[0].endsWith('/scripts/start.mjs'));
assert.equal(portableMcp.mcpServers.mail.startup_timeout_sec, undefined);
const marketplace = JSON.parse(await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
assert.equal(marketplace.name, 'multi-mail-reader'); assert.equal(marketplace.plugins[0].source.path, './');
assert.ok(manifest.interface.shortDescription.length <= 30);
for (const asset of ['logo', 'composerIcon']) await readFile(join(root, manifest.interface[asset]));
await readFile(join(root, 'scripts/start.mjs'));
if (!process.argv.includes('--source-only')) {
  for (const file of ['dist/server.cjs', 'dist/extract-worker.cjs', 'dist/accounts.html', 'dist/node_modules/unpdf/package.json', 'THIRD_PARTY_LICENSES.md']) await readFile(join(root, file));
}
console.log(`Validated ${checked} UTF-8 files, plugin identities, marketplace, MCP declarations, and assets.`);
