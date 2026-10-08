import { z } from 'zod';

const host = z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.:[\]_-]+$/, '主机名不能包含协议、路径或空格');
const username = z.string().trim().min(1).max(320);
const port = z.number().int().min(1).max(65535);
export const accountInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(320),
  isDefault: z.boolean().default(false),
  imap: z.object({ host, port: port.default(993), username, password: z.string().max(4096).optional() }).strict(),
  smtp: z.object({
    host, port: port.default(465), reuseImapCredentials: z.boolean().default(true),
    username: username.optional(), password: z.string().max(4096).optional(),
  }).strict().optional(),
}).strict();
export type AccountInput = z.infer<typeof accountInput>;
export interface StoredAccount {
  id: string;
  name: string;
  email: string;
  isDefault: boolean;
  imap: { host: string; port: number; username: string; passwordCipher: string };
  smtp?: { host: string; port: number; reuseImapCredentials: boolean; username?: string; passwordCipher?: string };
}
export interface PublicAccount {
  id: string; name: string; email: string; isDefault: boolean;
  imap: { host: string; port: number; username: string; hasPassword: boolean; security: 'SSL/TLS' };
  smtp?: { host: string; port: number; username?: string; reuseImapCredentials: boolean; hasPassword: boolean; security: 'SSL/TLS' };
}
export interface AccountFile { version: 1; accounts: StoredAccount[] }
export interface MessageRef { accountId: string; folder: string; uidValidity: string; uid: number }
export const MAX_ATTACHMENT = 25 * 1024 * 1024;
export const MAX_TEXT_PART = 5 * 1024 * 1024;

export function publicAccount(a: StoredAccount): PublicAccount {
  return {
    id: a.id, name: a.name, email: a.email, isDefault: a.isDefault,
    imap: { host: a.imap.host, port: a.imap.port, username: a.imap.username, hasPassword: !!a.imap.passwordCipher, security: 'SSL/TLS' },
    ...(a.smtp ? { smtp: {
      host: a.smtp.host, port: a.smtp.port, username: a.smtp.username,
      reuseImapCredentials: a.smtp.reuseImapCredentials,
      hasPassword: a.smtp.reuseImapCredentials ? !!a.imap.passwordCipher : !!a.smtp.passwordCipher,
      security: 'SSL/TLS' as const,
    } } : {}),
  };
}

export function encodeRef(ref: MessageRef): string {
  return Buffer.from(JSON.stringify(ref)).toString('base64url');
}
export function decodeRef(value: string): MessageRef {
  try {
    const ref = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return z.object({ accountId: z.uuid(), folder: z.string().min(1).max(1024), uidValidity: z.string().regex(/^\d+$/), uid: z.number().int().positive() }).strict().parse(ref);
  } catch { throw new Error('邮件引用无效，请重新搜索邮件。'); }
}

export function pageText(text: string, offset = 0, limit = 16000) {
  const end = Math.min(text.length, offset + limit);
  return { text: text.slice(offset, end), offset, totalCharacters: text.length, nextOffset: end < text.length ? end : null, truncated: end < text.length };
}
