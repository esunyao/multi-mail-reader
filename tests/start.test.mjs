import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureRuntime, readSource, runProcess } from '../scripts/start.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const testBase = join(repository, '..', '..', 'work', 'test-data');
const outputs = ['dist/server.cjs', 'dist/extract-worker.cjs', 'dist/accounts.html', 'dist/node_modules/unpdf/package.json', 'dist/node_modules/unpdf/dist/index.cjs', 'dist/node_modules/unpdf/dist/pdfjs.mjs', 'THIRD_PARTY_LICENSES.md'];

async function fixture() {
  await mkdir(testBase, { recursive: true });
  const directory = await mkdtemp(join(testBase, 'startup-'));
  const root = join(directory, 'source with spaces');
  const cacheRoot = join(directory, 'cache with spaces');
  for (const [path, bytes] of (await readSource(repository)).files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  return { root, cacheRoot, log() {} };
}

async function successfulBuild(directory) {
  for (const path of outputs) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), `fixture: ${path}`);
  }
}

async function assertNoPartial(cacheRoot) {
  assert.deepEqual((await readdir(cacheRoot)).filter(name => name.includes('.stage-') || name.endsWith('.lock')), []);
}

test('concurrent startups build once, then reuse the cache without touching source', async () => {
  const options = await fixture();
  let builds = 0;
  const build = async directory => { builds++; await delay(80); await successfulBuild(directory); };
  const [first, second] = await Promise.all([ensureRuntime({ ...options, build }), ensureRuntime({ ...options, build })]);
  assert.equal(first, second);
  assert.equal(builds, 1);
  assert.equal(await ensureRuntime({ ...options, build: async () => { throw new Error('Must not build a complete cache'); } }), first);
  await assert.rejects(readFile(join(options.root, 'dist/server.cjs')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(options.root, 'node_modules/package.json')), { code: 'ENOENT' });
  await assertNoPartial(options.cacheRoot);
});

test('corrupted and missing runtime files trigger a rebuild', async () => {
  const options = await fixture();
  let builds = 0;
  const build = async directory => { builds++; await successfulBuild(directory); };
  const runtime = await ensureRuntime({ ...options, build });
  await writeFile(join(runtime, 'dist/server.cjs'), 'corrupted');
  await ensureRuntime({ ...options, build });
  assert.equal(builds, 2);
  await rm(join(runtime, 'dist/node_modules/unpdf/dist/index.cjs'));
  await ensureRuntime({ ...options, build });
  assert.equal(builds, 3);
  await assertNoPartial(options.cacheRoot);
});

test('failed builds and incomplete output do not publish a cache and can be retried', async () => {
  const options = await fixture();
  await assert.rejects(ensureRuntime({ ...options, build: async directory => {
    await mkdir(join(directory, 'dist'));
    await writeFile(join(directory, 'dist/server.cjs'), 'partial');
    throw new Error('Simulated npm/network failure');
  } }), /Simulated npm\/network failure/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
  await assert.rejects(ensureRuntime({ ...options, build: async directory => {
    await successfulBuild(directory);
    await rm(join(directory, 'dist/extract-worker.cjs'));
  } }), /Build output is missing/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
  await ensureRuntime({ ...options, build: successfulBuild });
  await assertNoPartial(options.cacheRoot);
});

test('timed out build processes exit without leaving a usable cache or lock', { timeout: 15000 }, async () => {
  const options = await fixture();
  await assert.rejects(ensureRuntime({ ...options, timeoutMs: 800,
    build: (directory, context) => runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: directory, ...context }),
  }), /timed out/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
  await ensureRuntime({ ...options, build: successfulBuild });
});

test('interrupted builds release their lock and a subsequent startup succeeds', async () => {
  const options = await fixture();
  const controller = new AbortController();
  await assert.rejects(ensureRuntime({ ...options, signal: controller.signal, build: async (directory, { signal }) => {
    await successfulBuild(directory);
    controller.abort(new Error('Interrupted fixture build'));
    signal.throwIfAborted();
  } }), /Interrupted fixture build/);
  assert.deepEqual(await readdir(options.cacheRoot), []);
  await ensureRuntime({ ...options, build: successfulBuild });
});

test('waiting startup can cancel without deleting the active builder lock', async () => {
  const options = await fixture();
  const controller = new AbortController();
  let entered;
  const started = new Promise(resolveStarted => { entered = resolveStarted; });
  let finish;
  const unblock = new Promise(resolveFinished => { finish = resolveFinished; });
  const first = ensureRuntime({ ...options, build: async directory => { entered(); await unblock; await successfulBuild(directory); } });
  await started;
  const waiting = ensureRuntime({ ...options, signal: controller.signal, build: async () => assert.fail('Duplicate build') });
  controller.abort(new Error('Cancelled waiting startup'));
  await assert.rejects(waiting);
  assert.equal((await readdir(options.cacheRoot)).filter(name => name.endsWith('.lock')).length, 1);
  finish();
  await first;
  await assertNoPartial(options.cacheRoot);
});

test('dead owner locks are recovered, but active owner locks are preserved', async () => {
  const options = await fixture();
  const snapshot = await readSource(options.root);
  const lock = join(options.cacheRoot, `${snapshot.fingerprint}.lock`);
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647, token: 'dead-owner' }));
  await ensureRuntime({ ...options, build: successfulBuild });
  await assertNoPartial(options.cacheRoot);
  await rm(join(options.cacheRoot, snapshot.fingerprint), { recursive: true });
  await mkdir(lock);
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'active-owner' }));
  await assert.rejects(ensureRuntime({ ...options, timeoutMs: 500, build: async () => assert.fail('Active lock must not be stolen') }), /timed out/);
  assert.equal(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).token, 'active-owner');
});

test('source and version upgrades select a new runtime without removing previous versions', async () => {
  const options = await fixture();
  const original = await ensureRuntime({ ...options, build: successfulBuild });
  await writeFile(join(options.root, 'src/upgrade.ts'), 'export const upgrade = true;\n');
  const updated = await ensureRuntime({ ...options, build: successfulBuild });
  assert.notEqual(original, updated);
  const packageInfo = JSON.parse(await readFile(join(options.root, 'package.json'), 'utf8'));
  packageInfo.version = '0.1.2';
  await writeFile(join(options.root, 'package.json'), JSON.stringify(packageInfo));
  const versioned = await ensureRuntime({ ...options, build: successfulBuild });
  assert.notEqual(updated, versioned);
  assert.equal((await readdir(options.cacheRoot)).length, 3);
});

test('child stdout and stderr are routed to the diagnostic sink and failures are reported', async () => {
  let logged = '';
  await runProcess(process.execPath, ['-e', 'console.log("build stdout"); console.error("build stderr");'], { log: bytes => { logged += bytes; } });
  assert.match(logged, /build stdout/);
  assert.match(logged, /build stderr/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)'], { log() {} }), /Build command failed \(7\)/);
});
