# 多邮箱收信

在 Windows 本机运行的 Codex 插件。通过插件配置页管理多个邮箱，由 Codex 按需查询邮件、阅读正文与附件。

## 使用

1. 在 Codex 的插件列表中找到“多邮箱收信”，打开配置页中的“管理邮箱”。也可以在对话中让 Codex 打开邮箱配置。
2. 添加邮箱地址、IMAP 主机、端口、用户名及密码或邮箱授权码。仅支持直接 SSL/TLS，默认端口 993。
3. 需要时保存 SMTP 配置，默认端口 465；第一版暂不发送邮件。
4. 保存后测试连接。在对话中提出请求，例如“查看所有邮箱最近的未读邮件”或“找到课程安排邮件，读一下附件”。

如果当前对话尚未发现新安装插件的工具，请重新加载 Codex 或在新对话中选择此插件。安装成功与当前对话的工具发现是两个独立步骤。

## 安装

需要 Windows、可用的 Windows PowerShell 5.1，以及 Node.js 22 或更新版本。发布包已经包含构建后的服务及运行依赖，无须在使用前安装 npm 依赖。

将 `multi-mail-reader.zip` 解压到一个固定目录。在解压目录的父目录运行：

```powershell
node .\multi-mail-reader\scripts\install.mjs
```

安装脚本创建同级的本地插件市场，使用当前 Codex CLI 的正式命令注册市场并安装插件。不会覆盖其他插件或替换已有邮箱配置。建议安装后重新加载 Codex。

## 数据与凭据

数据保存在 `%LOCALAPPDATA%\Codex\multi-mail-reader`，独立于插件版本及安装缓存。

- `accounts.json`：邮箱配置，密码使用 Windows 当前用户的 DPAPI 加密。模型和列表工具只看到是否已保存密码。
- `attachments`：按需获取的附件原文件，按独立随机目录保存。邮件正文不持久缓存；附件文件不会自动打开或执行。

升级或重新安装插件会保留数据。加密密码只能由原 Windows 用户解密，迁移电脑或用户后需重新输入。卸载插件不会删除数据；删除单个邮箱只删除本地配置，不影响服务器邮件，也不清理已下载的附件。

## 支持范围

- 多邮箱、默认邮箱、文件夹列表、按条件搜索、分页、正文读取；所有 IMAP 文件夹均以只读方式打开，不修改已读状态。
- 文本、带文字的 PDF、DOCX、XLSX 附件可提取内容；PNG、JPEG、WebP、GIF 可返回图片供 Codex 查看。
- 单附件上限 25 MB，直接返回图片上限 10 MB。PDF 最多 500 页；附件解析最多 30 秒，文字最多提取 200 万字符，工具返回按段读取。
- 不支持扫描件 OCR、旧版 DOC/XLS、压缩包解析、OAuth、STARTTLS、后台监听、发信或邮箱内容修改。
- 日期筛选使用 IMAP 的内部收信日期，排序优先使用邮件 Date；分页为实时查询，新邮件到达时列表可能变化。
- SMTP 凭据可复用 IMAP，也可独立保存；本版不测试 SMTP 登录。

## 开发与验证

```powershell
npm ci
npm run check
npm run build
npm test
npm run package
```

源码位于 `src` 与 `ui`，工具入口为 `src/server.ts`。`dist` 为可直接启动的构建产物；`scripts/package.mjs` 打包时排除开发依赖和实际邮箱数据。测试使用隔离目录和测试邮箱服务，不连接用户邮箱。

实现使用 ImapFlow、MailParser、官方 MCP SDK、OpenAI MCP Extensions、PDF.js（通过 unpdf）、Mammoth、ExcelJS 和 Lucide。发布包附带所使用依赖的许可文本。
