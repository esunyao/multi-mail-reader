import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, lstat, access, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const inputs = ['package.json', 'package-lock.json', 'tsconfig.json', 'scripts/build.mjs', 'scripts/start.mjs', 'src', 'ui'];
const requiredFiles = ['dist/server.cjs', 'dist/extract-worker.cjs', 'dist/accounts.html', 'dist/node_modules/unpdf/package.json', 'dist/node_modules/unpdf/dist/index.cjs', 'dist/node_modules/unpdf/dist/pdfjs.mjs', 'THIRD_PARTY_LICENSES.md'];
const diagnostic = value => process.stderr.write(value);

function contained(root, target) {
  const path = relative(resolve(root), resolve(target));
  if (!path || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) throw new Error('Runtime path must remain inside the cache directory.');
  return resolve(target);
}

async function filesUnder(root, path, files = new Map()) {
  const info = await lstat(join(root, path));
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(join(root, path))).sort()) await filesUnder(root, `${path}/${name}`, files);
  } else if (info.isFile()) files.set(path, await readFile(join(root, path)));
  else throw new Error(`Not a regular file: ${path}`);
  return files;
}

export async function readSource(root) {
  const files = new Map();
  for (const path of inputs) await filesUnder(root, path, files);
  const hash = createHash('sha256').update(JSON.stringify([process.versions.node.split('.')[0], process.platform, process.arch]));
  for (const [path, bytes] of files) hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  return { files, fingerprint: hash.digest('hex'), version: JSON.parse(files.get('package.json').toString('utf8')).version };
}

async function outputHashes(root) {
  const files = await filesUnder(root, 'dist');
  files.set('THIRD_PARTY_LICENSES.md', await readFile(join(root, 'THIRD_PARTY_LICENSES.md')));
  for (const path of requiredFiles) if (!files.has(path) || !files.get(path).length) throw new Error(`Build output is missing: ${path}`);
  return Object.fromEntries([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]));
}

async function completeRuntime(directory, snapshot) {
  try {
    const ready = JSON.parse(await readFile(join(directory, 'ready.json'), 'utf8'));
    return ready.fingerprint === snapshot.fingerprint && ready.version === snapshot.version
      && JSON.stringify(ready.files) === JSON.stringify(await outputHashes(directory));
  } catch { return false; }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function ownsLock(path, token) {
  try { return JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')).token === token; }
  catch { return false; }
}

async function recoverLock(cacheRoot, path) {
  let owner;
  try { owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')); }
  catch {
    try { if (Date.now() - (await stat(path)).mtimeMs < 60000) return; }
    catch { return; }
  }
  if (owner && processAlive(owner.pid)) return;
  const stale = contained(cacheRoot, `${path}.stale-${randomUUID()}`);
  try {
    await rename(path, stale);
    let moved;
    try { moved = JSON.parse(await readFile(join(stale, 'owner.json'), 'utf8')); } catch {}
    if (moved && processAlive(moved.pid)) {
      try { await rename(stale, path); } catch {}
      return;
    }
    await rm(stale, { recursive: true, force: true });
  } catch (error) { if (!['ENOENT', 'EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
}

async function npmEntry() {
  const candidates = new Set([dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]);
  for (const directory of candidates) {
    if (!directory) continue;
    for (const path of [join(directory.replace(/^"|"$/g, ''), 'node_modules/npm/bin/npm-cli.js'), join(directory, '../lib/node_modules/npm/bin/npm-cli.js')]) {
      try { await access(path); return await realpath(path); } catch {}
    }
    if (process.platform !== 'win32') {
      try { return await realpath(join(directory, 'npm')); } catch {}
    }
  }
  throw new Error('Cannot find npm. Install Node.js 22 or newer with npm, then restart Codex.');
}

export function runProcess(command, args, { cwd, signal, log = diagnostic } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', npm_config_update_notifier: 'false' } });
    let abortReason;
    let killTimer;
    const abort = () => {
      abortReason = signal.reason;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.on('error', () => child.kill());
        killTimer = setTimeout(() => child.kill(), 2000);
        killTimer.unref();
      } else child.kill('SIGTERM');
    };
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    const clean = () => { signal?.removeEventListener('abort', abort); clearTimeout(killTimer); };
    child.once('error', error => { clean(); reject(error); });
    child.once('close', (code, terminationSignal) => {
      clean();
      if (abortReason) reject(abortReason);
      else if (code !== 0) reject(new Error(`Build command failed (${terminationSignal ?? code}): ${args[0] ?? command}`));
      else resolveProcess();
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function buildRuntime(directory, { signal, log }) {
  log('Preparing mail runtime: installing locked dependencies.\n');
  await runProcess(process.execPath, [await npmEntry(), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev'], { cwd: directory, signal, log });
  log('Preparing mail runtime: building service and settings.\n');
  await runProcess(process.execPath, ['scripts/build.mjs'], { cwd: directory, signal, log });
  await rm(contained(directory, join(directory, 'node_modules')), { recursive: true, force: true });
}

export async function ensureRuntime({ root = sourceRoot, cacheRoot, timeoutMs = 540000, signal, build = buildRuntime, log = diagnostic } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  if (!cacheRoot) {
    if (!process.env.LOCALAPPDATA && !process.env.MULTI_MAIL_RUNTIME_DIR) throw new Error('Cannot locate Windows runtime cache directory.');
    cacheRoot = process.env.MULTI_MAIL_RUNTIME_DIR ?? join(process.env.LOCALAPPDATA, 'Codex', 'multi-mail-reader-runtime');
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const snapshot = await readSource(root);
  const destination = contained(cacheRoot, join(cacheRoot, snapshot.fingerprint));
  if (await completeRuntime(destination, snapshot)) return destination;
  await mkdir(cacheRoot, { recursive: true });
  const lock = contained(cacheRoot, `${destination}.lock`);
  const token = randomUUID();
  let acquired = false;
  let staging;
  try {
    while (!acquired) {
      combined.throwIfAborted();
      try { await mkdir(lock); acquired = true; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await completeRuntime(destination, snapshot)) return destination;
        await recoverLock(cacheRoot, lock);
        await delay(200, undefined, { signal: combined });
      }
    }
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
    if (await completeRuntime(destination, snapshot)) return destination;
    staging = contained(cacheRoot, join(cacheRoot, `.stage-${randomUUID().slice(0, 12)}`));
    await mkdir(staging);
    for (const [path, bytes] of snapshot.files) {
      combined.throwIfAborted();
      const target = contained(staging, join(staging, path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await build(staging, { signal: combined, log });
    combined.throwIfAborted();
    const files = await outputHashes(staging);
    await writeFile(join(staging, 'ready.json'), JSON.stringify({ fingerprint: snapshot.fingerprint, version: snapshot.version, files }));
    combined.throwIfAborted();
    if (!await ownsLock(lock, token)) throw new Error('Runtime build lock changed. Please retry.');
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    staging = undefined;
    log('Mail runtime is ready.\n');
    return destination;
  } catch (error) {
    if (deadline.aborted) throw new Error('Mail runtime preparation timed out. Check npm/network access and restart Codex to retry.');
    if (combined.aborted) throw combined.reason;
    throw error;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (acquired && await ownsLock(lock, token)) await rm(lock, { recursive: true, force: true });
  }
}

async function main() {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Mail runtime preparation was interrupted. Restart Codex to retry.'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const directory = await ensureRuntime({ signal: controller.signal });
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (!process.argv.includes('--prepare')) await import(pathToFileURL(join(directory, 'dist', 'server.cjs')).href);
  } catch (error) {
    diagnostic(`Mail plugin startup failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
