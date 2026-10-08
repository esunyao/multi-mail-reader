# 多邮箱收信

> **Vibe Coding 提醒**：本项目采用 AI 辅助开发，不应视为已经通过专业安全审计或生产环境验证。它会接触邮箱凭据、邮件和附件，请在使用前审查代码，先用测试邮箱验证，不要未经评估就接入含有敏感信息的重要邮箱。已完成的测试及验证边界见 [验证记录](VERIFICATION.md)。

面向 Codex 的 Windows 本地邮箱插件。自定义 IMAP 服务器，在配置界面管理多个邮箱，让 Codex 按需查找邮件、阅读正文和附件。

**第一版仅收信，不发送邮件，也不修改服务器上的已读状态。** SMTP 配置可以保存，供后续扩展使用。

## 功能

- 管理多个邮箱：新增、编辑、删除配置，设置默认邮箱。
- 自定义 IMAP/SMTP 主机、端口、用户名和密码，不绑定特定邮箱服务商。
- IMAP 使用直接 SSL/TLS 连接，校验服务器证书；不支持明文连接或 STARTTLS。
- 查询单个或全部邮箱，按发件人、主题、关键词、日期和未读状态筛选。
- 阅读中文邮件与 HTML 正文，HTML 转换为文本，不加载远程图片。
- 按需获取附件，提取文本、PDF、Word 和 Excel 内容，或返回图片供 Codex 查看。
- 密码在本机使用 Windows 当前用户的 DPAPI 加密，独立于插件安装目录保存。

## 安装

### 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows，当前版本依赖 Windows DPAPI |
| Codex | 支持本地插件的 Codex 桌面端，以及可用的 Codex CLI |
| Node.js | 22 或更新版本，`node` 可从命令行启动 |
| npm 与网络 | 首次启动需要可用的 npm，以及访问锁文件中依赖下载地址的网络 |
| PowerShell | Windows PowerShell 5.1 可用，用于凭据加解密及安装 |
| 邮箱 | 已开启 IMAP，支持直接 SSL/TLS 和密码或邮箱授权码登录 |

### 通过 Git 远程市场安装

在 Git Bash 中运行：

```bash
codex plugin marketplace add https://github.com/esunyao/multi-mail-reader --ref main
codex plugin add multi-mail-reader@multi-mail-reader
```

重新加载 Codex，在新对话中选择“多邮箱收信”，再从插件配置页打开“管理邮箱”。插件市场与源码位于同一 Git 仓库；项目通过 Git 分发，不发布 GitHub Release。

Git 仓库**不提交 `dist` 或任何 `node_modules` 目录**。首次启动时，插件将所需源码复制到独立缓存，安装锁定依赖并构建服务。这个过程需要 Node.js、npm 和网络，最长等待约 9 分钟；Codex 原生启动等待设为 10 分钟。准备完成后直接复用缓存，正常启动无需再次安装依赖或联网构建。

更新市场后重新安装插件，使更新后的源码进入安装缓存：

```bash
codex plugin marketplace upgrade multi-mail-reader
codex plugin add multi-mail-reader@multi-mail-reader
```

重新加载 Codex 后，新源码会选择新的运行缓存，邮箱配置继续沿用。

### 本地源码安装

本地开发或使用源码 ZIP 时，在插件根目录运行：

```bash
node scripts/install.mjs
```

此脚本创建同级的 `multi-mail-local-marketplace`，注册本地市场并安装 `multi-mail-reader@multi-mail-local`。本地安装也使用首次启动自动构建，不必先在源码目录生成依赖或 `dist`。请保留本地市场目录，它是这种安装方式的来源。

### 运行缓存与重试

运行缓存位于 `%LOCALAPPDATA%\Codex\multi-mail-reader-runtime`，与邮箱数据目录分开。缓存按源码、依赖锁文件、Node.js 主版本、操作系统和处理器架构区分；使用前会校验构建文件的完整性。

- 同时打开多个对话时，同一份源码只构建一次，其余启动等待构建完成。
- 准备失败、超时或中断时，不会启用半成品。检查 npm 和网络后，重新加载 Codex 或重试启动。
- 文件缺失或损坏时自动重新构建。清理缓存前请先关闭正在使用插件的对话，只清理 `multi-mail-reader-runtime`，不要删除存放邮箱数据的 `multi-mail-reader` 目录。
- 构建期间的输出写入诊断日志，不混入邮件工具的通信结果。依赖安装禁用生命周期脚本；构建完成后移除开发依赖，只保留运行所需文件。

也可以在源码根目录提前准备缓存，便于排查首次启动问题：

```bash
node scripts/start.mjs --prepare
```

配置 `MULTI_MAIL_RUNTIME_DIR` 环境变量可指定独立运行缓存位置，供测试或受限环境使用。此变量不会改变邮箱数据目录。

## 配置邮箱

在插件配置页打开“管理邮箱”，也可以对 Codex 说“打开邮箱配置”。密码和授权码只在配置表单中输入，不要发到聊天中。

| 配置项 | 说明 |
| --- | --- |
| 邮箱名称 | 用于区分账号，例如“学校邮箱”“工作邮箱” |
| 邮箱地址 | 完整邮箱地址 |
| IMAP 主机 | 邮箱服务商提供的服务器名，不含协议前缀或路径 |
| IMAP 端口 | 默认 `993`，可自定义，必须对应直接 SSL/TLS 服务 |
| IMAP 用户名 | 按服务商要求填写，通常是完整邮箱地址 |
| IMAP 密码 | 邮箱密码或服务商提供的邮箱授权码 |
| SMTP 配置 | 可选，默认端口 `465`；可复用 IMAP 凭据或单独填写 |

点击“保存”只保存配置；点击“保存并测试”会保存配置并测试 IMAP 连接。测试失败时配置仍会保留，可以继续修改。

编辑邮箱时，密码框保持空白表示保留原密码。删除邮箱只删除本地配置，不会删除服务器邮件。SMTP 本版仅保存配置，不测试连接、不发送邮件。

插件不会预先添加任何账号，示例服务器地址也不会自动套用。请以邮箱服务商提供的设置为准。

## 使用示例

选择插件后，可以直接用自然语言提出请求：

> 查看所有邮箱最近的未读邮件。

> 在学校邮箱里找最近一周主题包含“课程安排”的邮件。

> 阅读这封邮件的正文，再提取附件 PDF 中的时间安排。

> 找到工作邮箱中的 Excel 报表，按工作表总结内容。

查询默认覆盖全部已配置邮箱的收件箱，结果带有所属邮箱和文件夹。需要其他文件夹时，可以先让 Codex 列出该邮箱的文件夹。

插件按需连接服务器，操作结束后释放连接，不在后台持续监听。一个邮箱连接失败时，其余邮箱仍可返回结果，并单独报告失败原因。

## 附件与限制

| 类型 | 支持情况 |
| --- | --- |
| 文本 | TXT、Markdown、CSV、TSV、JSON、XML、HTML 等，返回可读文本 |
| PDF | 提取已有文字，标注页码；不包含扫描件 OCR |
| Word | 支持 `.docx` 正文提取，不保留完整排版 |
| Excel | 支持 `.xlsx`，按工作表和行输出文本，不执行公式 |
| 图片 | PNG、JPEG、WebP、GIF，可返回图片内容供 Codex 查看 |
| 其他 | 不支持内容提取时保留原文件，并返回说明和本地路径 |

- 单个附件最大 **25 MB**；直接返回的图片最大 **10 MB**。
- PDF 最多 **500 页**；附件解析最多 **30 秒**，最多提取 **200 万字符**。
- 单个正文分段最大 **5 MB**；长正文和附件文本通过工具分段返回，截断或解析失败会明确提示。
- 不支持旧版 `.doc` / `.xls`、压缩包解析、OAuth、STARTTLS、发信、回复、删除或移动邮件。
- 日期筛选基于 IMAP 内部收信日期，排序优先采用邮件 `Date`。分页是实时查询，新邮件到达或邮件移动后结果可能变化。
- 大量匹配邮件会增加查询耗时，建议通过日期、主题或发件人缩小范围。

## 隐私与安全

默认数据目录：

```text
%LOCALAPPDATA%\Codex\multi-mail-reader
├── accounts.json
└── attachments\
```

- `accounts.json` 保存邮箱配置和加密后的密码。邮箱地址、主机名、用户名等配置项不是加密存储。
- 密码通过 Windows 当前用户 DPAPI 保护，不放入插件包、Git 仓库或模型可见的工具结果；邮件协议日志默认关闭。
- DPAPI 用于保护本地存储，不防护已能以同一 Windows 用户身份运行的恶意程序。迁移电脑或 Windows 用户后，应重新输入密码。
- 正文不由插件持久缓存；按需下载的附件以原文件保存，**附件文件不加密**，也不会自动打开或执行。
- 文件名经过处理，附件保存到独立随机目录，避免路径穿越和同名覆盖。
- 升级、重装及卸载插件不会自动清理数据；删除邮箱配置也不会清理已下载附件。清理前请确认不再需要这些文件。
- **本地运行不等于邮件内容不会交给模型。** 被调用工具返回的邮件正文、附件文本和图片会进入 Codex 的处理流程；请遵守所在组织的数据使用要求。
- 配套技能要求将邮件和附件中的指令视为不可信内容，不能据此改变用户任务、泄露凭据或自行执行操作。这不是对所有提示注入风险的绝对防护。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `list_accounts` | 列出邮箱和默认邮箱，不返回密码 |
| `list_folders` | 列出指定邮箱的文件夹；不指定时使用默认邮箱 |
| `search_messages` | 查询单个或全部邮箱，返回摘要、所属邮箱及邮件引用 |
| `read_message` | 使用邮件引用读取正文及附件清单 |
| `read_attachment` | 使用邮件引用和附件 ID 获取附件内容 |
| `manage_accounts` | 打开邮箱配置界面，不接收密码参数 |

`accounts_list`、`accounts_save`、`accounts_delete`、`accounts_default`、`accounts_test` 仅供配置界面使用，不向模型开放。

### 查询与分页

`search_messages` 支持 `accountId`、`folder`、`from`、`subject`、`keyword`、`since`、`before`、`unreadOnly`、`offset` 和 `limit`。

- 不指定 `accountId` 时查询全部邮箱；默认文件夹为 `INBOX`。
- 关键词匹配主题或正文；同时填写的其他条件共同生效。
- 日期格式为 `YYYY-MM-DD`，`since` 包含当天，`before` 不包含当天。
- 每页默认 **20 封**，最多 **100 封**，按时间倒序排列。
- 返回 `messages`、`total`、`nextOffset` 和 `errors`；`total` 只统计成功查询邮箱的匹配结果。
- 使用返回的 `ref` 读取邮件。引用绑定邮箱、文件夹、UIDVALIDITY 和 UID，邮件移动、删除或文件夹标识变化后，需要重新查询。
- 正文及附件文本每段默认 **16,000 字符**，最多 **32,000 字符**，通过 `body.nextOffset` 或 `text.nextOffset` 继续读取。

## 开发

在仓库根目录运行：

```bash
npm ci
npm run check
npm run build
npm test
node scripts/validate.mjs
npm run package
```

`npm run package` 在仓库的父目录生成 `multi-mail-reader.zip`。打包排除 `.git`、根目录开发依赖、测试数据、环境文件和日志，保留 `dist` 下的必要运行依赖。不要将真实邮箱数据复制进源码目录。

`node_modules` 和 `dist` 由 `.gitignore` 排除。本地 ZIP 打包仍可保留构建产物供开发验证，安装后的启动入口统一使用独立运行缓存；打包不会创建 GitHub Release。

修改 `src` 或 `ui` 后，开发测试需要重新执行 `npm run build`。已安装插件使用安装时的源码副本，需要更新市场并重新安装；只修改工作目录中的源码不会更新已安装插件。第三方许可文件由构建脚本重新生成，打包时应保留。

`npm test` 包含一次纯源码冷启动验证，需要 npm 和依赖下载网络；测试的运行缓存和邮箱数据均使用隔离目录。仅校验源码清单和编码、不要求工作目录存在 `dist` 时，可运行 `node scripts/validate.mjs --source-only`。

界面测试需要已安装 Google Chrome，在构建后运行：

```bash
npm run test:ui
```

```text
multi-mail-reader/
├── .agents/plugins/   Git 插件市场清单
├── .codex-plugin/     Codex 原生插件清单
├── assets/            邮箱图标
├── dist/              本地构建生成，不提交 Git
├── scripts/           构建、安装、打包和验证脚本
├── skills/read-mail/  Codex 查信与安全处理指导
├── src/               TypeScript MCP 服务及邮件处理
├── tests/             配置、TLS IMAP、正文和附件测试
├── ui/                中文邮箱管理界面
├── .mcp.json          Codex 原生启动声明，等待 600 秒
└── mcp.json           MCP 服务配置
```

自动化测试使用隔离数据目录和本地测试 IMAP 服务，不登录用户邮箱。已完成的检查与尚需真实环境确认的项目见 [验证记录](VERIFICATION.md)。

主要依赖包括 ImapFlow、MailParser、官方 MCP SDK、OpenAI MCP Extensions、PDF.js（通过 unpdf）、Mammoth、ExcelJS 和 Lucide。依赖版本由 `package-lock.json` 锁定，随包附带的依赖许可见 [第三方许可](THIRD_PARTY_LICENSES.md)。

## 常见问题

### 安装后找不到插件工具

重新加载 Codex，在新对话中启用或选择“多邮箱收信”。安装成功不代表已打开的对话会立即刷新工具清单。如果没有配置入口，可让 Codex 调用 `manage_accounts`；界面显示仍需要宿主支持 MCP Apps。

### 安装提示找不到 Node.js 或 Codex

确认 Git Bash 中的 `node --version` 与 `codex --version` 能正常运行。安装脚本还需要能通过 Windows PowerShell 调用 `codex.cmd`，仅在某个终端内定义的别名不够。

### 首次启动提示准备失败或长时间等待

确认 `node --version` 不低于 22，`npm --version` 可用，网络可以下载依赖。运行 `node scripts/start.mjs --prepare` 查看准备过程，完成后重新加载 Codex。无需在源码目录手动创建 `dist`。

Codex 原生声明包含 600 秒启动等待；其他通用 MCP 客户端需要在其自身设置中调整首次启动等待，或先执行上述准备命令。

本仓库使用 `.codex-plugin/plugin.json` 作为 Codex 插件清单，不同时放置根目录 `plugin.json`。当前桌面版优先选择根目录通用清单，而通用 MCP 格式不支持启动超时字段；同时放置会使原生声明的 600 秒设置失效。`mcp.json` 仍保留标准格式，可供其他 MCP 客户端配置服务；它本身不是跨宿主插件安装包。

### IMAP 登录失败

确认服务商已开启 IMAP，用户名正确，并按要求使用邮箱授权码。只支持 OAuth 的账号不能使用本版。修改配置后使用“保存并测试”重试，不要在聊天中提供密码。

### 服务器拒绝连接或证书验证失败

核对主机名、端口和网络。端口必须是直接 SSL/TLS 服务，不能使用仅支持 STARTTLS 的端口。插件不提供关闭证书校验的选项。

### 无法提取附件文字

检查格式和大小；扫描 PDF、加密文档或损坏文件可能无法读取。工具会报告限制或解析错误，并在已下载时提供原文件路径，不会将解析失败当作空白内容。

### 升级后需要重新配置邮箱吗

在同一 Windows 用户和电脑上，正常升级或重装会保留原数据。迁移到其他电脑或用户后应重新输入密码。第一版没有独立的迁移或导出向导。
