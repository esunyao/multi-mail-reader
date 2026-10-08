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
const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
const compat = JSON.parse(await readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
assert.equal(compat.name, manifest.name); assert.equal(compat.version, manifest.version);
assert.equal(compat.interface.displayName, manifest.extensions['com.openai'].interface.displayName);
assert.ok(manifest.extensions['com.openai'].interface.shortDescription.length <= 30);
for (const asset of ['logo', 'composerIcon']) await readFile(join(root, manifest.extensions['com.openai'].interface[asset]));
for (const file of ['dist/server.cjs', 'dist/extract-worker.cjs', 'dist/accounts.html', 'dist/node_modules/unpdf/package.json', 'THIRD_PARTY_LICENSES.md']) await readFile(join(root, file));
console.log(`Validated ${checked} UTF-8 files, plugin identities, runtime entrypoints, and assets.`);
