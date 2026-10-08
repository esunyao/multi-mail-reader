import { createRequire } from 'node:module';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AccountStore } from '../src/store.js';
import type { AccountInput } from '../src/types.js';
const require = createRequire(import.meta.url);
const hoodiecrow = require('hoodiecrow-imap');
const selfsigned = require('selfsigned');
const MailComposer = require('nodemailer/lib/mail-composer');

export const testProtector = {
  async protect(value: string) { return Buffer.from(`fixture:${value}`).toString('base64'); },
  async unprotect(value: string) { return Buffer.from(value, 'base64').toString().slice(8); },
};
export async function testDirectory(prefix: string) {
  const base = join(process.cwd(), '..', '..', 'work', 'test-data');
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}
export async function temporaryStore() { return new AccountStore(await testDirectory('store-'), testProtector); }
export function account(port: number, overrides: Partial<AccountInput> = {}): AccountInput {
  return { name: '测试邮箱', email: 'test@example.com', isDefault: false,
    imap: { host: 'localhost', port, username: 'testuser', password: 'testpass' }, ...overrides };
}
export async function compose(options: Record<string, unknown>) {
  return new Promise<Buffer>((resolve, reject) => new MailComposer({ from: 'sender@example.com', to: 'test@example.com', ...options }).compile().build((err: Error, data: Buffer) => err ? reject(err) : resolve(data)));
}
let certificate: any;
export async function testImap(messages: Buffer[]) {
  certificate ??= await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 2, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
      { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }],
  });
  const server = hoodiecrow({ secureConnection: true, credentials: { key: certificate.private, cert: certificate.cert },
    plugins: ['ID', 'NAMESPACE', 'UNSELECT', 'LITERAL+'],
    storage: { INBOX: { uidvalidity: 100, messages: messages.map((m, i) => ({ uid: i + 1, raw: m.toString('utf8'), internaldate: '07-Oct-2026 09:00:00 +0000', flags: [] })) } },
  });
  const commands: string[] = [];
  server.connectionHandlers.push((connection: any) => connection.socket.on('data', (chunk: Buffer) => commands.push(chunk.toString('utf8'))));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, commands, cert: certificate.cert, port: server.address().port,
    close: () => new Promise<void>(resolve => { for (const connection of server.connections) connection.socket.destroy(); server.close(resolve); }),
  };
}
