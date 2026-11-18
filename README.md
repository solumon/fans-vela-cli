# VELA CLI

<img src="assets/vela-logo.png" alt="VELA 标志" width="320">

## 让 AI 帮你安装

把下面这段提示词复制给 Codex、Cursor、OpenCode、Hermes 或 WorkBuddy。

```text
请在我实际运行 AI 工具的环境中安装 VELA CLI，并按仓库 README 配置我需要的技能。

仓库是 https://github.com/solumon/fans-vela-cli ，需要 GitHub 读取权限。使用我现有的 GitHub 登录。如果无法访问，请告诉我需要开通仓库权限。

1. 将仓库克隆到一个长期保留的目录。如果已有该仓库，先确认远端地址，再复用它。
2. 在项目目录使用 Node.js 26，执行 npm ci、npm run build 和 npm link。检查当前环境能运行 vela --help。如果本机缺少 Google Chrome，请告诉我。
3. 安装工时技能时，Codex、Cursor、OpenCode 或 Hermes 使用 npm run install:skill。WorkBuddy 使用 npm run pack:release 生成技能 ZIP，告诉我 ZIP 的完整路径，供我在「上传技能」中导入。
4. 如果我需要缺陷技能，在本仓库中使用 .agents/skills/fans-vela-defect。若要在其他工作区使用，复制整个目录到当前工具支持的技能目录，保留 references/。
5. 核对 vela 命令和所需技能是否就绪，汇报安装位置。提示我在自己的终端运行 vela login 并用企业微信扫码，再运行 vela auth status 核对登录结果。
```

## 你能怎么用

登录 VELA 后，可以直接用下面的说法请 AI 帮你查询或准备修改。

| 场景 | 关键词 | 可以这样说 |
| --- | --- | --- |
| 查工作日报和工时 | VELA 工作日报、已填工时、可填报项目 | 看一下我今天的 VELA 工作日报，列出各项目已填工时和当天合计。 |
| 补登或修改工时 | VELA 工时、补登工时、改进度 | 预览补登昨天的 VELA 工时。音频项目 3.5 小时，进度 60%，工作内容是完成播放联调。 |
| 查开发任务 | VELA 开发任务、任务编号、关联应用、变更历史 | 查看 VELA 开发任务 #26 的关联应用、开发计划和变更历史。 |
| 给任务关联应用 | 添加关联应用、提测分支、应用版本 | 预览给 VELA 开发任务 #26 关联 `example-api`，提测分支是 `dev`，版本是 `2.4.9`。 |
| 查自己正在处理的缺陷 | VELA 缺陷、PMS 缺陷列表、当前处理人 | 列出当前由我处理、状态为「新建」的 VELA 缺陷。 |
| 看缺陷详情并排查代码 | 缺陷详情链接、看一下、查一下 | 粘贴 VELA 缺陷详情链接，再说「看一下这个缺陷，帮我定位相关代码」。 |
| 转交或流转缺陷 | 转交缺陷、流转缺陷、已解决 | 预览把 VELA 缺陷 #73 流转为「已解决」，处理人设为用户 ID 123。 |
| 修改自己发过的流转留言 | 缺陷评论、修改流转留言、评论 ID | 查一下 VELA 缺陷 #73 的评论，预览把我发的「请复测」改成「请用最新测试包复测」。 |

填报工时、关联应用、流转缺陷和修改评论时，可以先让 AI [预览改动](#预览与提交)，核对后再确认提交。

## 功能概览

在终端查询和更新 VELA 的工作日报、开发任务和缺陷。CLI 使用 TypeScript 编写，由 tsdown 打包。

| 功能 | 支持的操作 |
| --- | --- |
| [工作日报](#工作日报) | 查询本人单日工时和可填报项目，补登或修改工时、进度与工作内容 |
| [开发任务](#开发任务) | 按编号查询任务、关联应用、开发计划和变更历史，添加应用关联 |
| [缺陷](#缺陷) | 查询当前由本人处理的缺陷和指定缺陷详情，转交、流转状态及修改本人评论 |

## 安装与构建

需要 Node.js 26、Google Chrome 和可登录 VELA 的企业微信账号。在项目目录执行以下命令。

```bash
npm ci
npm run build
npm link
vela --help
vela login
vela auth status
```

用企业微信扫描 `vela login` 显示的二维码并确认。登录后可用 `vela hours day` 查询当天工时，或用 `vela defect list` 查询当前处理人为自己的缺陷。

开发时可用 `npm run typecheck` 检查类型，`npm test` 构建并运行测试。

## 打包与分发

使用 Node.js 26，安装项目依赖后运行以下命令。打包需要 POSIX shell 和 `zip`，默认输出到 `release/`。可用 `npm run pack:release -- /path/to/output` 指定目录。

```bash
npm ci
npm run pack:release
```

- `vela-cli-<版本>.tgz` 是 CLI 安装包。接收者使用 Node.js 26 安装，例如 `npm install -g ./vela-cli-0.1.0.tgz`，然后执行 `vela --help` 和 `vela login`。
- `fans-vela-daily-register-<版本>.zip` 是技能包。Codex、Cursor 和 OpenCode 可从本项目的 `.agents/skills/` 发现技能，也可将 ZIP 内的技能目录解压到目标项目的 `.agents/skills/`。WorkBuddy 可通过「上传技能」导入 ZIP。

## AI 技能

仓库在 `.agents/skills/` 下提供两个技能。运行技能的环境需要能调用 `vela` 并访问 VELA，每位使用者用自己的账号扫码登录。

| 技能 | 用途 |
| --- | --- |
| [fans-vela-daily-register](.agents/skills/fans-vela-daily-register/SKILL.md) | 查询和登记本人工作日报 |
| [fans-vela-defect](.agents/skills/fans-vela-defect/SKILL.md) | 查询及排查缺陷、流转状态和修改已发布的评论 |

### 安装工时技能

```bash
npm run install:skill
```

脚本把工时技能复制到 `~/.agents/skills/fans-vela-daily-register`。OpenCode 可直接读取该目录。有对应应用目录时，脚本也会创建以下软链接。

- `~/.cursor/skills/fans-vela-daily-register`
- `~/.codex/skills/fans-vela-daily-register`
- `~/.hermes/skills/fans-vela-daily-register`

通用目录中已有不同版本的 `SKILL.md` 时，脚本会先把目标目录备份为 `fans-vela-daily-register.bak-<时间戳>`。WorkBuddy 可通过「上传技能」导入[打包生成的 ZIP](#打包与分发)。

### 使用缺陷技能

在能读取仓库技能的 AI 工具中，从本仓库调用 `$fans-vela-defect`。跨工作区使用时，将 `.agents/skills/fans-vela-defect/` 整个目录复制到工具支持的技能目录，保留其中的 `references/`。`npm run install:skill` 和发布 ZIP 目前仅支持工时技能。

## 登录、检查与退出

```bash
vela login
vela auth status
vela logout
```

`vela login` 在终端显示 VELA 的企业微信登录二维码。用企业微信扫码并确认后，CLI 向 VELA 核验当前账号，再保存本地会话。默认等待 180 秒，可用 `--timeout` 指定 10 至 900 秒，例如 `vela login --timeout 300`。如需在 Chrome 窗口中显示二维码，运行 `vela login --browser`。

`auth status` 无需打开浏览器。它向 VELA 核验会话，访问令牌过期时尝试刷新。CLI 会话默认位于 `~/.vela/auth.json`。如果设置了非空的 `XDG_STATE_HOME`，则使用 `$XDG_STATE_HOME/.vela/auth.json`。如果新文件不存在，CLI 会自动迁移对应的旧会话文件 `~/.local/state/vela-cli/session.json` 或 `$XDG_STATE_HOME/vela-cli/session.json`。会话文件和目录的权限分别为 `0600` 和 `0700`。

`vela logout` 调用 VELA 的退出接口，服务端确认后清除本地会话。如果已经退出，重复执行也会成功。退出请求失败时，CLI 会保留本地会话，便于重试。

## 预览与提交

添加任务应用、流转缺陷、更新评论和填报工时都使用同一套流程。

1. 先执行预览命令，核对目标和改动。使用 `--json` 可从结果中读取 `previewId`。
2. 确认有需要提交的改动后，将这次预览返回的 `previewId` 赋给示例中的 shell 变量 `preview_id`，用相同参数加上 `--apply "$preview_id"` 提交。
3. JSON 结果中的 `submitted: true` 表示 CLI 已回查确认。遇到 `PREVIEW_STALE` 时重新预览。遇到 `SUBMIT_UNCERTAIN` 时先查询实际结果，再决定是否重试。

## 开发任务

```bash
vela task
vela task get 26
vela task get 26 --json
```

`get` 按开发任务编号只读查询。终端分别用表格显示任务信息和关联应用。`--json`、管道或重定向输出单行 JSON，其中 `task` 为任务详情，`applications` 为关联应用，`members` 为开发成员，`plan` 为开发计划，`attachments` 为附件清单，`history` 为自动翻页获取的变更记录。

### 关联应用

```bash
vela task app add 26 --app example-api --branch dev --json
vela task app add 26 --app example-api --branch dev --apply "$preview_id" --json
```

`--app` 按应用名称精确匹配。遇到同名应用，或已知应用 ID，可改用 `--app-id`。提测分支默认是 `dev`，可用 `--version` 指定三段数字版本号，例如 `2.4.9`。一个应用在同一任务中只关联一次。提交结果不明确时，用 `vela task get 26` 核对关联应用。

## 缺陷

```bash
vela defect list
vela defect list --status 新建 --page 2 --page-size 20 --json
vela defect get 73
vela defect get 73 --history --json
```

`list` 查询当前处理人为登录账号的缺陷，默认包含所有状态，显示第 1 页，每页 50 条。`--status` 支持状态名称或编号，`--page-size` 可设为 1 至 100。`get` 按缺陷编号显示详情、附件和账号可用的流转动作。加 `--history` 可查看流转和变更的完整记录。

### 转交和状态流转

```bash
vela defect transition 73 --to 123 --message "请协助排查"
vela defect transition 73 --status 已解决 --to 123 --message "已修复, 打包 report6-html 验证" --json
vela defect transition 73 --status 已解决 --to 123 --message "已修复, 打包 report6-html 验证" --apply "$preview_id" --json
```

`--status` 接受 VELA 状态名称或编号。省略它时只转交，`--to` 填目标处理人的 VELA 用户 ID。指定状态时，是否需要处理人由该动作决定，备注可选。如果动作还有必填字段，先在 VELA 缺陷详情中补齐。

使用缺陷技能流转为「已解决」时，默认备注里的打包名称取实际要打包的软件包在 `package.json` 中的顶层 `name`。手动执行 CLI 时通过 `--message` 传入备注。提交结果不明确时，用 `vela defect get 73 --history` 核对流转记录。

### 查询和更新评论

```bash
vela defect comments 73 --json
vela defect update 73 --comment 387 --message "已修复, 打包 report6-html 验证" --json
vela defect update 73 --comment 387 --message "已修复, 打包 report6-html 验证" --apply "$preview_id" --json
```

先用 `comments` 查询评论 ID，再预览要替换的正文。仅支持更新当前登录用户发布的评论。新正文按纯文本处理，支持换行，流转历史保留当时提交的备注。提交结果不明确时，用 `vela defect comments 73` 核对评论。

## 工作日报

```bash
vela hours day
vela hours day --date 2026-11-06
vela hours day --json
vela hours projects
vela hours projects --json
vela hours submit --date 2026-11-06 --file entries.json --json
vela hours submit --date 2026-11-06 --file entries.json --apply "$preview_id" --json
```

`day` 默认查询北京时间当天，在交互终端先显示合计，再用表格列出项目、手填工时、待办工时、进度和工作内容，窄终端用单列表格。`projects` 在交互终端用两列表格显示可添加的项目 ID 和名称，终端太窄时逐项显示。这两个命令都可以通过管道、重定向或 `--json` 获取单行 JSON。

`entries.json` 是用 UTF-8 编码的单日项目数组。提交须指定 `--date YYYY-MM-DD`，日期最晚为北京时间当天。新增记录要提供工时、进度和工作内容，修改记录可以只提供变更字段。使用 `--file -` 可从标准输入读取 JSON。

```json
[
  {"projectId": 123, "hours": 3.5, "progress": 60, "content": "完成音频播放联调"},
  {"projectId": 456, "hours": 4.5}
]
```

每个项目的 `hours` 可填 0.5 至 24 小时，按 0.5 小时递增。`progress` 为 0 至 100 的整数，`content` 去掉首尾空白后须有 1 至 1000 字。提交结果不明确时，用 `vela hours day --date 2026-11-06` 核对对应日期的记录。

## VELA 后端 API

下表列出当前 CLI 使用的后端接口。API 基址为 `https://vela-api.up366demo.cn/admin-api`，表中的路径均相对于此基址。已登录的业务请求使用 `Authorization: Bearer <accessToken>`。

扫码时，CLI 还会打开 VELA 登录页并读取企业微信二维码。登录页和企业微信二维码地址属于浏览器登录依赖，表中只列 VELA 后端接口。

### 认证与会话

实现见[认证请求](src/vela.ts)和[扫码登录](src/browser-login.ts)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/system/auth/wecom/login` | `login` 打开登录页并等待浏览器完成企业微信扫码，从该请求的响应读取 VELA 会话。 |
| `GET` | `/system/auth/get-permission-info` | 登录后及 `auth status` 核验账号。任务关联、缺陷和日报命令也用它获取当前用户。 |
| `POST` | `/system/auth/refresh-token` | 访问令牌过期时，通过 `refreshToken` 查询参数换取新会话。 |
| `POST` | `/system/auth/logout` | `logout` 注销服务端会话。 |

### 开发任务

实现见[任务命令](src/task.ts)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/pmp/dev-task/get` | 按 `id` 查询开发任务详情。 |
| `GET` | `/pmp/dev-task-app/list` | 按 `devTaskId` 查询已有应用关联，用于详情、预览和提交后回查。 |
| `GET` | `/pmp/dev-task-member/list` | 按 `devTaskId` 查询开发成员。 |
| `GET` | `/pmp/task/list` | 用 `businessType=pmp_dev_task` 和 `businessId` 查询开发计划。 |
| `GET` | `/pmp/application/app/page` | `task app add --app` 按 `appName` 分页查找应用。 |
| `GET` | `/pmp/application/app/get` | `task app add --app-id` 按 `id` 查找应用。 |
| `POST` | `/pmp/dev-task-app/create` | `task app add --apply` 创建任务和应用的关联。 |

### 缺陷

实现见[缺陷命令](src/defect.ts)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/pmp/defect/page` | `defect list` 分页查询当前用户处理的缺陷，支持按状态筛选。 |
| `GET` | `/pmp/defect/get` | 按 `id` 查询缺陷详情。评论和流转命令也用它核对缺陷。 |
| `GET` | `/pmp/defect/status-list` | 获取状态编号与名称，用于筛选、展示和解析流转目标。 |
| `GET` | `/pmp/defect/action-list` | 按 `id` 查询可用流转动作、候选处理人和必填字段。 |
| `GET` | `/system/user/simple-list` | 指定 `--to` 时查询并核对目标处理人。 |
| `GET` | `/fsm/transition-log/page` | 按 `bizType=pmp_defect` 和 `bizId` 分页读取流转历史，并用于流转预览和回查。 |
| `PUT` | `/pmp/defect/change-status` | `defect transition --apply` 提交流转状态、处理人和可选备注。 |
| `GET` | `/pmp/comment/list` | 按 `bizType=pmp_defect` 和 `bizId` 查询缺陷评论，用于列表、更新预览和回查。 |
| `PUT` | `/pmp/comment/update` | `defect update --comment … --apply` 按评论 `id` 更新正文。 |

### 任务与缺陷共用

实现见[任务命令](src/task.ts)和[缺陷命令](src/defect.ts)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/pmp/attachment/list` | 按 `bizType` 和 `bizId` 查询附件清单。 |
| `GET` | `/pmp/change-log/page` | 按 `bizType` 和 `bizId` 分页查询变更历史。 |

### 工作日报

实现见[日报命令](src/hours.ts)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/pmp/daily-report/reportable-project-list` | 查询可填报项目。预览新增日报项目时也会查询。 |
| `GET` | `/pmp/daily-report/my-card-list` | 按 `date` 查询本人指定日期的日报卡片，用于 `hours day`、预览和回查。 |
| `POST` | `/pmp/daily-report/submit` | `hours submit --apply` 提交指定日期的日报条目。 |

## AI 调用

交互终端会显示表格、操作预览和等待动画。通过管道、重定向或添加 `--json` 运行查询和提交等业务命令时，执行结果会以单行 JSON 写到标准输出。帮助命令输出纯文本。二维码和扫码提示写到标准错误，登录令牌保存在本机。AI 可读取退出码以及结果中的 `error.code`，例如 `LOGIN_REQUIRED`、`SESSION_EXPIRED` 或 `NETWORK_ERROR`。

成功退出码为 `0`，执行失败为 `1`，参数无效为 `2`。

```json
{"ok":true,"authenticated":true,"account":{"nickname":"示例用户"}}
```

```json
{"ok":false,"error":{"code":"LOGIN_REQUIRED","message":"请先运行 vela login 完成企微扫码。"}}
```
