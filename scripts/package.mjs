import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = {};
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    const rel = relative(root, file).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) continue;
    if (rel === '.git' || rel === 'node_modules' || rel === 'coverage' || rel.startsWith('.test') || /^\.env(?:\.|$)/.test(entry.name) || entry.name.endsWith('.log')) continue;
    if (entry.isDirectory()) await walk(file);
    else files[`multi-mail-reader/${rel}`] = new Uint8Array(await readFile(file));
  }
}
await walk(root);
const manifest = JSON.parse(Buffer.from(files['multi-mail-reader/.codex-plugin/plugin.json']).toString());
if (manifest.name !== 'multi-mail-reader' || manifest.interface.shortDescription.length > 30) throw new Error('Invalid plugin manifest');
for (const path of ['dist/server.cjs', 'dist/extract-worker.cjs', 'dist/accounts.html', 'mcp.json', '.codex-plugin/plugin.json']) if (!files[`multi-mail-reader/${path}`]) throw new Error(`Missing ${path}`);
await writeFile(join(dirname(root), 'multi-mail-reader.zip'), zipSync(files, { level: 6 }));
console.log(`Packaged ${Object.keys(files).length} files without development dependencies or account data.`);
