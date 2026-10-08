import { ImapFlow, type MessageStructureObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { AccountStore } from './store.js';
import { decodeRef, encodeRef, MAX_ATTACHMENT, MAX_TEXT_PART, pageText } from './types.js';
import type { ConnectionOptions } from 'node:tls';

export interface SearchInput {
  accountId?: string; folder?: string; from?: string; subject?: string; keyword?: string;
  since?: string; before?: string; unreadOnly?: boolean; offset?: number; limit?: number;
}
interface Part { part: string; type: string; size: number; filename?: string; charset?: string; encoding?: string; attachment: boolean }
export function flattenParts(node: MessageStructureObject, result: Part[] = []): Part[] {
  const mime = node.type?.toLowerCase() ?? 'application/octet-stream';
  const disposition = node.disposition?.toLowerCase();
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
  if (!node.childNodes?.length || disposition === 'attachment' || filename) {
    result.push({ part: node.part || '1', type: mime, size: node.size ?? 0, filename,
      charset: node.parameters?.charset, encoding: node.encoding,
      attachment: disposition === 'attachment' || !!filename || !['text/plain', 'text/html'].includes(mime) });
  } else node.childNodes.forEach(child => flattenParts(child, result));
  return result;
}

export function mailError(error: unknown): string {
  const e = error as { code?: string; authenticationFailed?: boolean; message?: string };
  if (e.authenticationFailed || e.code === 'AUTHENTICATIONFAILED' || /authentication|invalid credentials|login failed/i.test(e.message ?? '')) return '登录失败，请检查用户名、密码或邮箱授权码，并确认已启用 IMAP。';
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(e.code ?? '')) return 'SSL/TLS 证书验证失败，请检查服务器地址和证书。';
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return '找不到邮箱服务器，请检查主机名和网络。';
  if (e.code === 'ECONNREFUSED') return '服务器拒绝连接，请检查端口及 SSL/TLS 设置。';
  if (/TIMEOUT|ETIMEDOUT/.test(e.code ?? '') || /timeout|timed out/i.test(e.message ?? '')) return '连接或查询超时，请稍后重试。';
  // Do not forward server responses: they may echo credentials or untrusted content.
  return '邮箱连接或查询失败，请检查网络及服务器设置后重试。';
}

export class MailService {
  constructor(private store: AccountStore, private tls: ConnectionOptions = {}) {}
  private async connected<T>(id: string, action: (client: ImapFlow) => Promise<T>): Promise<T> {
    const account = await this.store.credentials(id);
    const client = new ImapFlow({
      host: account.imap.host, port: account.imap.port, secure: true,
      auth: { user: account.imap.username, pass: account.password },
      tls: { ...this.tls, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      logger: false, logRaw: false, emitLogs: false,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      disableAutoIdle: true,
    });
    client.on('error', () => {});
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        (async () => { await client.connect(); return action(client); })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { client.close(); reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })); }, 90000); }),
      ]);
    } catch (e) {
      if (e instanceof UserMailError) throw e;
      throw new UserMailError(mailError(e));
    } finally {
      clearTimeout(timer);
      client.close();
    }
  }
  async testConnection(id: string) {
    return this.connected(id, async client => {
      const folders = await client.list();
      return { ok: true, message: 'IMAP 连接成功', folderCount: folders.length };
    });
  }
  async listFolders(id?: string) {
    const account = await this.store.get(id);
    return this.connected(account.id, async client => ({
      accountId: account.id, folders: (await client.list()).map(f => ({ path: f.path, name: f.name, specialUse: f.specialUse, selectable: !f.flags.has('\\Noselect') })),
    }));
  }
  async search(input: SearchInput) {
    const accounts = input.accountId ? [await this.store.get(input.accountId)] : await this.store.list();
    if (!accounts.length) throw new Error('尚未添加邮箱，请在插件配置页打开“管理邮箱”。');
    const folder = input.folder ?? 'INBOX';
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 20;
    const results = await Promise.all(accounts.map(async account => {
      try {
        const messages = await this.connected(account.id, async client => {
          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const box = client.mailbox;
            if (!box) throw new UserMailError('无法打开邮件文件夹。');
            const query = {
              ...(input.from ? { from: input.from } : {}), ...(input.subject ? { subject: input.subject } : {}),
              ...(input.keyword ? { or: [{ subject: input.keyword }, { body: input.keyword }] } : {}),
              ...(input.since ? { since: new Date(input.since + 'T00:00:00Z') } : {}),
              ...(input.before ? { before: new Date(input.before + 'T00:00:00Z') } : {}),
              ...(input.unreadOnly ? { seen: false } : {}),
            };
            const uids = await client.search(Object.keys(query).length ? query : { all: true }, { uid: true });
            if (!uids || !uids.length) return [];
            const found: any[] = [];
            for await (const m of client.fetch(uids, { uid: true, envelope: true, flags: true, internalDate: true, size: true }, { uid: true })) {
              const envelope = m.envelope;
              found.push({
                ref: encodeRef({ accountId: account.id, folder, uidValidity: String(box.uidValidity), uid: m.uid }),
                accountId: account.id, accountName: account.name, email: account.email, folder,
                subject: envelope?.subject ?? '(无主题)', from: envelope?.from ?? [], to: envelope?.to ?? [],
                date: new Date(envelope?.date ?? m.internalDate ?? 0).toISOString(),
                unread: !m.flags?.has('\\Seen'), size: m.size ?? 0,
              });
            }
            return found;
          } finally { lock.release(); }
        });
        return { messages, error: undefined };
      } catch (e) { return { messages: [], error: { accountId: account.id, accountName: account.name, message: (e as Error).message } }; }
    }));
    const messages = results.flatMap(r => r.messages).sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref));
    const end = Math.min(messages.length, offset + limit);
    return { messages: messages.slice(offset, end), total: messages.length, offset, nextOffset: end < messages.length ? end : null,
      errors: results.flatMap(r => r.error ? [r.error] : []) };
  }
  private async selected<T>(reference: string, action: (client: ImapFlow, uid: number, structure: MessageStructureObject, envelope: any) => Promise<T>) {
    const ref = decodeRef(reference);
    return this.connected(ref.accountId, async client => {
      const lock = await client.getMailboxLock(ref.folder, { readOnly: true });
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== ref.uidValidity) throw new UserMailError('文件夹内容标识已改变，请重新搜索后读取邮件。');
        const message = await client.fetchOne(ref.uid, { uid: true, bodyStructure: true, envelope: true }, { uid: true });
        if (!message || !message.bodyStructure) throw new UserMailError('邮件已移动或删除，请重新搜索。');
        return action(client, ref.uid, message.bodyStructure, message.envelope);
      } finally { lock.release(); }
    });
  }
  private async download(client: ImapFlow, uid: number, part: string, maximum: number) {
    const result = await client.download(uid, part, { uid: true });
    if (!result.content || !result.meta) throw new UserMailError('邮件或正文分段已不存在，请重新搜索。');
    let length = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of result.content) {
        length += chunk.length;
        if (length > maximum) { result.content.destroy(); throw new UserMailError(`内容超过 ${Math.round(maximum / 1024 / 1024)} MB 上限。`); }
        chunks.push(Buffer.from(chunk));
      }
      return { data: Buffer.concat(chunks), meta: result.meta };
    } catch (e) { result.content.destroy(); throw e; }
  }
  async readMessage(reference: string, offset = 0, limit = 16000) {
    return this.selected(reference, async (client, uid, structure, envelope) => {
      const parts = flattenParts(structure);
      const textParts = parts.filter(p => !p.attachment);
      const plain = textParts.filter(p => p.type === 'text/plain');
      const selected = plain.length ? plain : textParts.filter(p => p.type === 'text/html');
      const blocks: string[] = [];
      const warnings: string[] = [];
      for (const part of selected) {
        if (part.size > MAX_TEXT_PART) { warnings.push(`正文分段 ${part.part} 超过 5 MB，未读取。`); continue; }
        const { data, meta } = await this.download(client, uid, part.part, MAX_TEXT_PART);
        const charset = String(meta.charset ?? part.charset ?? 'utf-8').replace(/[\r\n"\\]/g, '');
        // ImapFlow already decodes transfer encoding; MailParser handles the declared charset.
        const parsed = await simpleParser(Buffer.concat([Buffer.from(`Content-Type: ${part.type}; charset="${charset}"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n`), data]), { skipHtmlToText: true, skipTextToHtml: true });
        blocks.push(part.type === 'text/html' ? convert(parsed.html || '', { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] }) : parsed.text ?? '');
      }
      return {
        ref: reference, subject: envelope?.subject ?? '(无主题)', from: envelope?.from ?? [], to: envelope?.to ?? [], cc: envelope?.cc ?? [],
        date: envelope?.date?.toISOString() ?? null,
        body: pageText(blocks.join('\n\n'), offset, limit), warnings,
        attachments: parts.filter(p => p.attachment).map(p => ({ attachmentId: p.part, filename: p.filename ?? `attachment-${p.part}`, contentType: p.type, encodedSize: p.size })),
      };
    });
  }
  async attachment(reference: string, attachmentId: string) {
    return this.selected(reference, async (client, uid, structure) => {
      const part = flattenParts(structure).find(p => p.attachment && p.part === attachmentId);
      if (!part) throw new UserMailError('附件不存在，请先读取邮件并使用返回的 attachmentId。');
      // BODYSTRUCTURE size may include base64 expansion; enforce the limit on decoded bytes.
      if (part.size > MAX_ATTACHMENT * 1.4 + 4096) throw new UserMailError('附件超过 25 MB 上限。');
      const { data, meta } = await this.download(client, uid, part.part, MAX_ATTACHMENT);
      return { data, filename: meta.filename ?? part.filename ?? `attachment-${part.part}`, contentType: meta.contentType ?? part.type, charset: meta.charset ?? part.charset };
    });
  }
}
export class UserMailError extends Error {}
