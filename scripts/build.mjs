import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Mail } from 'lucide';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
await mkdir('dist', { recursive: true });
await mkdir('assets', { recursive: true });
const nodeOptions = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', metafile: true, external: ['unpdf', 'pdfjs-dist', '@napi-rs/canvas'] };
const server = await build({ ...nodeOptions, entryPoints: ['src/server.ts'], outfile: 'dist/server.cjs' });
const worker = await build({ ...nodeOptions, entryPoints: ['src/extract-worker.ts'], outfile: 'dist/extract-worker.cjs' });
await cp('node_modules/unpdf', 'dist/node_modules/unpdf', { recursive: true });
const ui = await build({ entryPoints: ['ui/app.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false, metafile: true, logLevel: 'warning' });
const readStyles = await readFile('ui/styles.css', 'utf8');
const html = (await readFile('ui/index.html', 'utf8')).replace('/* APP_STYLES */', () => readStyles).replace('/* APP_SCRIPT */', () => ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
await writeFile('dist/accounts.html', html);
const paths = Mail[2].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${value}"`).join(' ')}/>`).join('');
await writeFile('assets/mail.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1b7784" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`);
const packages = new Set(['node_modules/unpdf']);
for (const result of [server, worker, ui]) for (const path of Object.keys(result.metafile.inputs)) {
  const matches = [...path.matchAll(/node_modules\/(?:@[^/]+\/)?[^/]+/g)];
  const last = matches.at(-1);
  if (last) packages.add(path.slice(0, last.index + last[0].length));
}
const licenses = [];
for (const path of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  const names = (await readdir(path)).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
  licenses.push(`## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? 'See package notice'}\n`);
  for (const name of names) {
    try { licenses.push(`\n${name}\n\n${await readFile(join(path, name), 'utf8')}\n`); } catch {}
  }
}
await writeFile('THIRD_PARTY_LICENSES.md', licenses.join('\n'));
await writeFile('dist/bundle-dependencies.json', JSON.stringify([...packages].sort(), null, 2));
console.log('Built server, attachment worker, and account settings.');
