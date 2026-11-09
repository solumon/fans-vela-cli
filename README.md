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

`auth status` 无需打开浏览器。它向 VELA 核验会话，访问令牌过期时尝试刷新。CLI 会话默认位于 `~/.local/state/vela-cli/session.json`。如果设置了 `XDG_STATE_HOME`，文件将位于该目录下的 `vela-cli/session.json`。会话文件和目录的权限分别为 `0600` 和 `0700`。

`vela logout` 调用 VELA 的退出接口，服务端确认后清除本地会话。如果已经退出，重复执行也会成功。退出请求失败时，CLI 会保留本地会话，便于重试。

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

## AI 调用

交互终端会显示表格、填报预览和等待动画。通过管道、重定向或为命令添加 `--json`，执行结果会以单行 JSON 写到标准输出。二维码和扫码提示写到标准错误，登录令牌保存在本机。AI 可读取退出码以及结果中的 `error.code`，例如 `LOGIN_REQUIRED`、`SESSION_EXPIRED` 或 `NETWORK_ERROR`。

成功退出码为 `0`，执行失败为 `1`，参数无效为 `2`。

```json
{"ok":true,"authenticated":true,"account":{"nickname":"示例用户"}}
```

```json
{"ok":false,"error":{"code":"LOGIN_REQUIRED","message":"请先运行 vela login 完成企微扫码。"}}
```
