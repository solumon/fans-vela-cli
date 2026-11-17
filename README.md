# VELA CLI

使用 TypeScript 编写，由 tsdown 打包，运行于 Node.js 26。登录需要安装 Google Chrome。

配套的工时登记技能在 `.agents/skills/fans-vela-daily-register`，可用于 Codex、Cursor、OpenCode、Hermes 与 WorkBuddy。

## 安装与构建

进入项目目录，用 Node.js 26 执行以下命令。

```bash
npm ci
npm run typecheck
npm run build
npm link
```

## 让 AI 帮你安装

把下面这段提示词复制给 Codex、Cursor、OpenCode 或 WorkBuddy。

```text
请在我实际运行 AI 工具的环境中安装 VELA CLI 和工时登记技能。

仓库是 https://github.com/solumon/fans-vela-cli ，需要 GitHub 读取权限。使用我现有的 GitHub 登录。如果无法访问，请告诉我需要开通仓库权限。

1. 将仓库克隆到一个长期保留的目录。如果已有该仓库，先确认远端地址，再复用它。
2. 在项目目录使用 Node.js 26，执行 npm ci、npm run build 和 npm link。检查当前环境能运行 vela --help。如果本机缺少 Google Chrome，请告诉我。
3. 根据我使用的 AI 工具安装技能：
   - Codex、Cursor、OpenCode、Hermes：将仓库 .agents/skills/fans-vela-daily-register 目录复制到 ~/.agents/skills/，让它能跨项目使用。如果已有同名技能，请先比对内容再更新。
   - Hermes、Cursor、Codex 还各自读自己的 skills 目录：运行 npm run install:skill 会复制到 ~/.agents/skills 并软链到 ~/.hermes/skills、~/.cursor/skills、~/.codex/skills（本机没装的应用自动跳过）。
   - WorkBuddy：运行 npm run pack:release 生成技能 ZIP，告诉我 ZIP 的完整路径，并提示我在 WorkBuddy 的「上传技能」中导入。
4. 核对 vela 命令和技能文件是否就绪，汇报安装位置。提示我在自己的终端运行 vela login 并用企业微信扫码，再运行 vela auth status 核对登录结果。
```

## 打包与分发

使用 Node.js 26，安装项目依赖后运行以下命令。打包需要 POSIX shell 和 `zip`，默认输出到 `release/`。可用 `npm run pack:release -- /path/to/output` 指定目录。

```bash
npm ci
npm run pack:release
```

- `vela-cli-<版本>.tgz` 是 CLI 安装包。接收者使用 Node.js 26 安装，例如 `npm install -g ./vela-cli-0.1.0.tgz`，然后执行 `vela --help` 和 `vela login`。
- `fans-vela-daily-register-<版本>.zip` 是技能包。Codex、Cursor 和 OpenCode 可从本项目的 `.agents/skills/` 发现技能，也可将 ZIP 内的技能目录解压到目标项目的 `.agents/skills/`。WorkBuddy 可通过「上传技能」导入 ZIP。

运行技能的环境需要能调用 `vela` 并访问 VELA。每位使用者用自己的账号扫码登录。

## 把技能装到本机

```bash
npm run install:skill
```

脚本把 `.agents/skills/fans-vela-daily-register` 复制到 `~/.agents/skills/fans-vela-daily-register`（Codex、Cursor、OpenCode 与其它读通用目录的 Agent 共用），再给本机存在的 Cursor、Codex、Hermes 软链：

- `~/.cursor/skills/fans-vela-daily-register`
- `~/.codex/skills/fans-vela-daily-register`
- `~/.hermes/skills/fans-vela-daily-register`

没装的应用自动跳过；目标已有不同内容时先备份到 `fans-vela-daily-register.bak-<时间戳>`。改完 `SKILL.md` 后重新执行一次即可。WorkBuddy 不走软链，用上面的打包步骤导入 ZIP。

## 登录、检查与退出

```bash
vela login
vela auth status
vela logout
```

`vela login` 在终端显示 VELA 的企业微信登录二维码。用企业微信扫码并确认后，CLI 向 VELA 核验当前账号，再保存本地会话。默认等待 180 秒，可用 `vela login --timeout 300` 调整。如需在 Chrome 窗口中显示二维码，运行 `vela login --browser`。

`auth status` 无需打开浏览器。它向 VELA 核验会话，访问令牌过期时尝试刷新。CLI 会话默认位于 `~/.vela/auth.json`。如果设置了非空的 `XDG_STATE_HOME`，则使用 `$XDG_STATE_HOME/.vela/auth.json`。如果新文件不存在，CLI 会自动迁移对应的旧会话文件 `~/.local/state/vela-cli/session.json` 或 `$XDG_STATE_HOME/vela-cli/session.json`。会话文件和目录的权限分别为 `0600` 和 `0700`。

`vela logout` 调用 VELA 的退出接口，服务端确认后清除本地会话。如果已经退出，重复执行也会成功。退出请求失败时，CLI 会保留本地会话，便于重试。

## 开发任务

```bash
vela task
vela task get 26
vela task get 26 --json
```

`get` 按开发任务编号只读查询。终端分别用表格显示任务信息和关联应用。`--json`、管道或重定向输出单行 JSON，其中 `task` 为任务详情，`applications` 为关联应用，`members` 为开发成员，`plan` 为开发计划，`attachments` 为附件清单，`history` 为自动翻页获取的变更记录。

### 关联应用

```bash
vela task app add 26 --app example-api --branch dev
vela task app add 26 --app example-api --branch dev --apply "$preview_id"
```

`--app` 按应用名称精确匹配。遇到同名应用，或已知应用 ID，可改用 `--app-id`。提测分支默认是 `dev`，可用 `--version` 指定版本号（如 `2.4.9`）。

首次运行显示预览，`--json` 可取得 `previewId`。确认后用相同参数加上 `--apply`，命令会创建关联并回查。一个应用在同一任务中只关联一次。如果返回 `SUBMIT_UNCERTAIN`，先用 `vela task get` 查看任务的关联应用，再决定是否重新预览。

## 缺陷

可在本仓库中调用 `$fans-vela-defect`，让 AI 查询并处理 VELA 缺陷。技能定义见 [fans-vela-defect/SKILL.md](.agents/skills/fans-vela-defect/SKILL.md)。

```bash
vela defect list
vela defect list --status 新建 --page 2 --page-size 20 --json
vela defect get 73
vela defect get 73 --history --json
```

`list` 查询当前处理人为登录账号的缺陷，默认包含所有状态，显示第 1 页（每页 50 条）。`get` 按缺陷编号显示详情、附件和账号可用的流转动作。加 `--history` 可查看流转和变更的完整记录。

```bash
vela defect transition 73 --to 123 --message "请协助排查"
vela defect transition 73 --status 已解决 --to 123 --message "已修复，请复测"
vela defect transition 73 --status 已解决 --to 123 --message "已修复，请复测" --apply "$preview_id"
```

`--status` 接受 VELA 状态名称或编号。省略它时只转交，`--to` 填目标处理人的 VELA 用户 ID。指定状态时，是否需要处理人由该动作决定，备注可选。如果动作还有必填字段，先在 VELA 缺陷详情中补齐。

首次执行流转命令会显示预览，使用 `--json` 可取得 `previewId`。确认后用相同参数加上 `--apply`，命令会提交并回查。遇到 `PREVIEW_STALE` 时重新预览。遇到 `SUBMIT_UNCERTAIN` 时，先用 `vela defect get <缺陷编号> --history` 核对流转结果。

### 查询和更新评论

```bash
vela defect comments 73 --json
vela defect update 73 --comment 387 --message "已修复, 打包 up366-teacher-html 验证" --json
vela defect update 73 --comment 387 --message "已修复, 打包 up366-teacher-html 验证" --apply "$preview_id" --json
```

先用 `comments` 查询评论 ID，再预览要替换的正文。仅支持更新当前登录用户发布的评论。新正文按纯文本处理，支持换行。用相同参数和预览返回的 `previewId` 提交后，CLI 会回查评论。遇到 `SUBMIT_UNCERTAIN` 时先用 `comments` 核对。流转历史记录保留当时提交的备注。

## 工作日报

```bash
vela hours day
vela hours day --date 2026-11-06
vela hours day --json
vela hours projects
vela hours projects --json
vela hours submit --date 2026-11-06 --file entries.json
vela hours submit --date 2026-11-06 --file entries.json --apply "$preview_id"
```

`day` 默认查询北京时间当天，在交互终端先显示合计，再用表格列出项目、手填工时、待办工时、进度和工作内容，窄终端用单列表格。`projects` 在交互终端用两列表格显示可添加的项目 ID 和名称，终端太窄时逐项显示。这两个命令都可以通过管道、重定向或 `--json` 获取单行 JSON。

`entries.json` 是单日的项目数组。新增记录要提供工时、进度和工作内容，修改记录可以只提供变更字段。使用 `--file -` 可从标准输入读取 JSON。

```json
[
  {"projectId": 123, "hours": 3.5, "progress": 60, "content": "完成音频播放联调"},
  {"projectId": 456, "hours": 4.5}
]
```

首次执行 `submit` 会输出改动前后的值和 `previewId`。确认后，用相同日期和输入加上 `--apply`。如果返回 `PREVIEW_STALE`，重新预览。如果返回 `SUBMIT_UNCERTAIN`，先用 `day` 检查是否已保存，再决定是否重新预览。

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

交互终端会显示表格、填报预览和等待动画。通过管道、重定向或为命令添加 `--json`，执行结果会以单行 JSON 写到标准输出。二维码和扫码提示写到标准错误，登录令牌保存在本机。AI 可读取退出码以及结果中的 `error.code`，例如 `LOGIN_REQUIRED`、`SESSION_EXPIRED` 或 `NETWORK_ERROR`。

成功退出码为 `0`，执行失败为 `1`，参数无效为 `2`。

```json
{"ok":true,"authenticated":true,"account":{"nickname":"示例用户"}}
```

```json
{"ok":false,"error":{"code":"LOGIN_REQUIRED","message":"请先运行 vela login 完成企微扫码。"}}
```
