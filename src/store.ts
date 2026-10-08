import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { accountInput, publicAccount, type AccountFile, type AccountInput, type StoredAccount } from './types.js';
import { WindowsDpapi, type SecretProtector } from './crypto.js';

export function dataDirectory() {
  if (!process.env.LOCALAPPDATA) throw new Error('无法定位 Windows 本地应用数据目录。');
  return join(process.env.LOCALAPPDATA, 'Codex', 'multi-mail-reader');
}

export class AccountStore {
  constructor(readonly directory = dataDirectory(), private crypto: SecretProtector = new WindowsDpapi()) {}
  private get file() { return join(this.directory, 'accounts.json'); }
  private async load(): Promise<AccountFile> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.accounts)) throw new Error('version');
      return data;
    } catch (e: any) {
      if (e.code === 'ENOENT') return { version: 1, accounts: [] };
      throw new Error('邮箱配置无法读取。请保留原文件并检查配置版本或文件完整性。');
    }
  }
  private async lock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(this.directory, '.accounts.lock');
    const deadline = Date.now() + 30000;
    while (true) {
      try { await mkdir(lockPath); break; }
      catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        try {
          const owner = Number(await readFile(join(lockPath, 'pid'), 'utf8'));
          if (owner > 0) {
            try { process.kill(owner, 0); }
            catch (err: any) { if (err.code === 'ESRCH') { await rm(lockPath, { recursive: true, force: true }); continue; } }
          }
        } catch {
          try { if (Date.now() - (await stat(lockPath)).mtimeMs > 60000) { await rm(lockPath, { recursive: true, force: true }); continue; } } catch {}
        }
        if (Date.now() > deadline) throw new Error('邮箱配置正在保存，请稍后重试。');
        await delay(100);
      }
    }
    try { await writeFile(join(lockPath, 'pid'), String(process.pid)); return await action(); }
    finally { await rm(lockPath, { recursive: true, force: true }); }
  }
  private async commit(data: AccountFile) {
    const temporary = join(this.directory, `.accounts-${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); await rename(temporary, this.file); }
    finally { await rm(temporary, { force: true }); }
  }
  async list() { return (await this.load()).accounts.map(publicAccount); }
  async get(id?: string): Promise<StoredAccount> {
    const accounts = (await this.load()).accounts;
    const account = id ? accounts.find(a => a.id === id) : accounts.find(a => a.isDefault) ?? accounts[0];
    if (!account) throw new Error(id ? '邮箱已删除或不存在，请重新查看邮箱列表。' : '尚未添加邮箱，请在插件配置页打开“管理邮箱”。');
    return account;
  }
  async credentials(id: string) {
    const a = await this.get(id);
    return { ...publicAccount(a), password: await this.crypto.unprotect(a.imap.passwordCipher) };
  }
  async save(raw: AccountInput) {
    const input = accountInput.parse(raw);
    return this.lock(async () => {
      const file = await this.load();
      const old = file.accounts.find(a => a.id === input.id);
      if (input.id && !old) throw new Error('邮箱已删除，请重新添加。');
      if (!input.imap.password && !old) throw new Error('请输入 IMAP 密码或邮箱授权码。');
      const account: StoredAccount = {
        id: old?.id ?? randomUUID(), name: input.name, email: input.email,
        isDefault: input.isDefault || file.accounts.length === 0 || !!old?.isDefault,
        imap: { host: input.imap.host, port: input.imap.port, username: input.imap.username,
          passwordCipher: input.imap.password ? await this.crypto.protect(input.imap.password) : old!.imap.passwordCipher },
      };
      if (input.smtp) {
        const smtp = input.smtp;
        if (!smtp.reuseImapCredentials && !smtp.username) throw new Error('请输入 SMTP 用户名。');
        const priorPassword = old?.smtp?.reuseImapCredentials === false ? old.smtp.passwordCipher : undefined;
        if (!smtp.reuseImapCredentials && !smtp.password && !priorPassword) throw new Error('请输入 SMTP 密码或选择复用 IMAP 凭据。');
        account.smtp = {
          host: smtp.host, port: smtp.port, reuseImapCredentials: smtp.reuseImapCredentials,
          ...(!smtp.reuseImapCredentials ? { username: smtp.username, passwordCipher: smtp.password ? await this.crypto.protect(smtp.password) : priorPassword } : {}),
        };
      }
      if (account.isDefault) file.accounts.forEach(a => { a.isDefault = false; });
      const index = file.accounts.findIndex(a => a.id === account.id);
      if (index < 0) file.accounts.push(account); else file.accounts[index] = account;
      await this.commit(file);
      return publicAccount(account);
    });
  }
  async remove(id: string) {
    return this.lock(async () => {
      const file = await this.load();
      file.accounts = file.accounts.filter(a => a.id !== id);
      if (file.accounts.length && !file.accounts.some(a => a.isDefault)) file.accounts[0].isDefault = true;
      await this.commit(file);
    });
  }
  async setDefault(id: string) {
    return this.lock(async () => {
      const file = await this.load();
      if (!file.accounts.some(a => a.id === id)) throw new Error('邮箱不存在。');
      file.accounts.forEach(a => { a.isDefault = a.id === id; });
      await this.commit(file);
    });
  }
}
