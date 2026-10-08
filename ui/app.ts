import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { createIcons, Mail, Plus, ArrowLeft, Pencil, Trash2, Star, PlugZap, ShieldCheck, Eye, EyeOff, Save, Check, X } from 'lucide';
import type { PublicAccount, AccountInput } from '../src/types.js';

const app = new App({ name: '邮箱配置', version: '0.1.0' });
const content = document.querySelector<HTMLElement>('#content')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const root = document.querySelector<HTMLElement>('#app')!;
let accounts: PublicAccount[] = [];
let current: PublicAccount | undefined;
let busy = false;
let initialReceived = false;
const states = new Map<string, { message: string; ok: boolean }>();

function escape(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function icons() { createIcons({ icons: { Mail, Plus, ArrowLeft, Pencil, Trash2, Star, PlugZap, ShieldCheck, Eye, EyeOff, Save, Check, X } }); }
function say(message = '', error = false) { notice.textContent = message; notice.className = error ? 'error' : ''; }
function setBusy(value: boolean) {
  busy = value; root.setAttribute('aria-busy', String(value));
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value; });
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '操作失败，请重试。');
  return result.structuredContent as any;
}
async function action(handler: () => Promise<void>) {
  if (busy) return;
  setBusy(true); say();
  try { await handler(); } catch (e) { say((e as Error).message, true); }
  finally { setBusy(false); }
}

function renderList() {
  current = undefined;
  content.innerHTML = `<div class="toolbar"><span class="count">${accounts.length} 个邮箱</span><button class="primary" id="add"><i data-lucide="plus"></i>添加邮箱</button></div>` +
    (accounts.length ? `<ul class="account-list">${accounts.map(a => {
      const state = states.get(a.id);
      return `<li class="account-row"><span class="mail-icon"><i data-lucide="mail"></i></span><div class="account-main"><div class="account-heading"><strong>${escape(a.name)}</strong>${a.isDefault ? '<span class="badge"><i data-lucide="check"></i>默认</span>' : ''}</div><p class="account-email">${escape(a.email)}</p>${state ? `<p class="connection-state ${state.ok ? 'success' : 'error'}">${escape(state.message)}</p>` : ''}</div><div class="row-actions">${a.isDefault ? '' : `<button class="icon" data-default="${a.id}" title="设为默认邮箱" aria-label="设为默认邮箱 ${escape(a.name)}"><i data-lucide="star"></i></button>`}<button class="icon" data-test="${a.id}" title="测试 IMAP 连接" aria-label="测试 IMAP 连接 ${escape(a.name)}"><i data-lucide="plug-zap"></i></button><button class="icon" data-edit="${a.id}" title="编辑邮箱" aria-label="编辑邮箱 ${escape(a.name)}"><i data-lucide="pencil"></i></button></div></li>`;
    }).join('')}</ul>` : '<div class="empty"><i data-lucide="mail"></i><p>还没有邮箱</p></div>');
  document.querySelector('#add')!.addEventListener('click', () => { say(); renderForm(); });
  content.querySelectorAll<HTMLElement>('[data-edit]').forEach(el => el.addEventListener('click', () => { say(); renderForm(accounts.find(a => a.id === el.dataset.edit)); }));
  content.querySelectorAll<HTMLElement>('[data-default]').forEach(el => el.addEventListener('click', () => action(async () => { accounts = (await call('accounts_default', { id: el.dataset.default })).accounts; renderList(); say('默认邮箱已更新'); })));
  content.querySelectorAll<HTMLElement>('[data-test]').forEach(el => el.addEventListener('click', () => action(async () => {
    const id = el.dataset.test!;
    states.set(id, { ok: true, message: '正在测试连接…' }); renderList(); setBusy(true);
    try { const result = await call('accounts_test', { id }); states.set(id, { ok: true, message: result.message }); }
    catch (e) { states.set(id, { ok: false, message: (e as Error).message }); }
    renderList();
  })));
  icons();
}

function passwordField(id: string, label: string, saved: boolean) {
  return `<div class="field"><label for="${id}">${label}</label><div class="password-wrap"><input id="${id}" name="${id}" type="password" maxlength="4096" autocomplete="new-password" ${saved ? 'placeholder="留空保留已保存密码"' : ''}><button type="button" class="icon" data-password="${id}" title="显示密码" aria-label="显示${label}"><i data-lucide="eye"></i></button></div></div>`;
}

function renderForm(account?: PublicAccount) {
  current = account;
  const smtp = account?.smtp;
  content.innerHTML = `<div class="form-heading"><button class="icon" id="back" title="返回邮箱列表" aria-label="返回邮箱列表"><i data-lucide="arrow-left"></i></button><h2>${account ? '编辑邮箱' : '添加邮箱'}</h2></div>
  <form id="account-form" autocomplete="off">
    <section class="form-section"><div class="fields">
      <div class="field"><label for="name">邮箱名称</label><input id="name" name="name" required maxlength="100" value="${escape(account?.name)}"></div>
      <div class="field"><label for="email">邮箱地址</label><input id="email" name="email" type="email" required maxlength="320" value="${escape(account?.email)}"></div>
      <label class="check wide"><input type="checkbox" id="isDefault" ${account?.isDefault || !accounts.length ? 'checked' : ''}>设为默认邮箱</label>
    </div></section>
    <section class="form-section"><div class="section-title"><h2>IMAP 配置</h2><span class="security"><i data-lucide="shield-check"></i>SSL/TLS</span></div><div class="fields">
      <div class="host-port"><div class="field"><label for="imapHost">主机名</label><input id="imapHost" required maxlength="253" placeholder="imap.exmail.qq.com" value="${escape(account?.imap.host)}"></div><div class="field"><label for="imapPort">端口</label><input id="imapPort" type="number" required min="1" max="65535" value="${account?.imap.port ?? 993}"></div></div>
      <div class="field"><label for="imapUsername">用户名</label><input id="imapUsername" required maxlength="320" value="${escape(account?.imap.username)}" autocomplete="username"></div>
      ${passwordField('imapPassword', '密码或授权码', !!account?.imap.hasPassword)}
    </div></section>
    <section class="form-section"><div class="section-title"><label class="check"><input type="checkbox" id="smtpEnabled" ${smtp ? 'checked' : ''}><strong>SMTP 配置</strong></label><span class="security">仅保存</span></div>
    <div id="smtpFields" ${smtp ? '' : 'hidden'}><div class="fields"><div class="host-port"><div class="field"><label for="smtpHost">主机名</label><input id="smtpHost" maxlength="253" placeholder="smtp.exmail.qq.com" value="${escape(smtp?.host)}"></div><div class="field"><label for="smtpPort">端口</label><input id="smtpPort" type="number" min="1" max="65535" value="${smtp?.port ?? 465}"></div></div>
    <label class="check wide"><input type="checkbox" id="smtpReuse" ${smtp?.reuseImapCredentials !== false ? 'checked' : ''}>复用 IMAP 用户名和密码</label>
    </div><div id="smtpCredentials" class="fields" style="margin-top:16px" ${smtp?.reuseImapCredentials === false ? '' : 'hidden'}><div class="field"><label for="smtpUsername">SMTP 用户名</label><input id="smtpUsername" maxlength="320" value="${escape(smtp?.username)}"></div>${passwordField('smtpPassword', 'SMTP 密码或授权码', !!smtp?.hasPassword && !smtp.reuseImapCredentials)}</div></div></section>
    <div class="form-footer"><button type="submit" class="primary"><i data-lucide="save"></i>保存</button><button type="button" id="save-test"><i data-lucide="plug-zap"></i>保存并测试</button><span class="spacer"></span>${account ? '<button type="button" class="icon danger" id="delete" title="删除邮箱配置" aria-label="删除邮箱配置"><i data-lucide="trash-2"></i></button>' : ''}</div>
  </form><div id="delete-panel" class="delete-panel" hidden><p>删除这个邮箱的本地配置？</p><button id="confirm-delete" class="danger">删除配置</button><button id="cancel-delete">取消</button></div>`;
  document.querySelector('#back')!.addEventListener('click', () => { say(); renderList(); });
  document.querySelector<HTMLInputElement>('#email')!.addEventListener('input', event => {
    const user = document.querySelector<HTMLInputElement>('#imapUsername')!;
    if (!user.dataset.edited) user.value = (event.target as HTMLInputElement).value;
  });
  const user = document.querySelector<HTMLInputElement>('#imapUsername')!;
  if (account) user.dataset.edited = 'true';
  user.addEventListener('input', () => { user.dataset.edited = 'true'; });
  content.querySelectorAll<HTMLElement>('[data-password]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.password!) as HTMLInputElement;
    const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
    button.title = visible ? '隐藏密码' : '显示密码'; button.setAttribute('aria-label', button.title);
    button.innerHTML = `<i data-lucide="${visible ? 'eye-off' : 'eye'}"></i>`; icons();
  }));
  const smtpToggle = document.querySelector<HTMLInputElement>('#smtpEnabled')!;
  const reuse = document.querySelector<HTMLInputElement>('#smtpReuse')!;
  const syncSmtp = () => {
    document.querySelector<HTMLElement>('#smtpFields')!.hidden = !smtpToggle.checked;
    document.querySelector<HTMLElement>('#smtpCredentials')!.hidden = reuse.checked;
    document.querySelectorAll<HTMLInputElement>('#smtpFields input:not([type=checkbox])').forEach(input => { input.disabled = !smtpToggle.checked; });
    document.querySelector<HTMLInputElement>('#smtpHost')!.required = smtpToggle.checked;
    document.querySelector<HTMLInputElement>('#smtpUsername')!.required = smtpToggle.checked && !reuse.checked;
    document.querySelectorAll<HTMLInputElement>('#smtpCredentials input').forEach(input => { input.disabled = !smtpToggle.checked || reuse.checked; });
  };
  smtpToggle.addEventListener('change', syncSmtp); reuse.addEventListener('change', syncSmtp); syncSmtp();
  document.querySelector<HTMLFormElement>('#account-form')!.addEventListener('submit', event => { event.preventDefault(); void save(false); });
  document.querySelector('#save-test')!.addEventListener('click', () => save(true));
  if (account) {
    document.querySelector('#delete')!.addEventListener('click', () => { document.querySelector<HTMLElement>('#delete-panel')!.hidden = false; });
    document.querySelector('#cancel-delete')!.addEventListener('click', () => { document.querySelector<HTMLElement>('#delete-panel')!.hidden = true; });
    document.querySelector('#confirm-delete')!.addEventListener('click', () => action(async () => {
      accounts = (await call('accounts_delete', { id: account.id })).accounts; renderList(); say('邮箱配置已删除');
    }));
  }
  icons();
}

async function save(test: boolean) {
  const form = document.querySelector<HTMLFormElement>('#account-form')!;
  if (!form.reportValidity()) return;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  if (!current && !input('imapPassword').value) { input('imapPassword').focus(); say('请输入 IMAP 密码或邮箱授权码。', true); return; }
  const account: AccountInput = {
    ...(current ? { id: current.id } : {}), name: input('name').value.trim(), email: input('email').value.trim(), isDefault: input('isDefault').checked,
    imap: { host: input('imapHost').value.trim(), port: Number(input('imapPort').value), username: input('imapUsername').value.trim(), password: input('imapPassword').value },
    ...(input('smtpEnabled').checked ? { smtp: {
      host: input('smtpHost').value.trim(), port: Number(input('smtpPort').value), reuseImapCredentials: input('smtpReuse').checked,
      ...(!input('smtpReuse').checked ? { username: input('smtpUsername').value.trim(), password: input('smtpPassword').value } : {}),
    } } : {}),
  };
  await action(async () => {
    const result = await call('accounts_save', { account, test });
    accounts = result.accounts;
    input('imapPassword').value = ''; input('smtpPassword').value = '';
    if (result.test) states.set(result.account.id, result.test);
    if (result.test && !result.test.ok) { renderForm(result.account); say(`配置已保存。${result.test.message}`, true); }
    else { renderList(); say(test ? '邮箱已保存，IMAP 连接成功' : '邮箱已保存'); }
  });
}

function applyTheme() {
  const context = app.getHostContext();
  if (context?.theme) { applyDocumentTheme(context.theme); document.documentElement.classList.toggle('dark', context.theme === 'dark'); document.documentElement.classList.toggle('light', context.theme === 'light'); }
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.ontoolresult = result => {
  const initial = result._meta?.accounts ?? result.structuredContent?.accounts;
  if (Array.isArray(initial)) { initialReceived = true; accounts = initial as PublicAccount[]; renderList(); setBusy(false); }
};
app.onhostcontextchanged = applyTheme;
icons();
app.connect().then(async () => {
  applyTheme();
  if (!initialReceived) { accounts = (await call('accounts_list')).accounts; renderList(); }
  setBusy(false);
}).catch(() => { root.setAttribute('aria-busy', 'false'); content.textContent = '邮箱配置暂时无法连接，请从插件配置页重新打开。'; });
