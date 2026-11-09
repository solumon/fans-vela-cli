# VELA CLI

使用 TypeScript 编写，由 tsdown 打包，运行于 Node.js 26。登录需要安装 Google Chrome。

## 安装与构建

进入项目目录，用 Node.js 26 执行以下命令。

```bash
npm ci
npm run typecheck
npm run build
npm link
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
vela hours projects
vela hours submit --date 2026-11-06 --file entries.json
vela hours submit --date 2026-11-06 --file entries.json --apply "$preview_id"
```

`day` 默认查询北京时间当天，返回手填工时、待办自动工时和当天合计。`projects` 返回可添加的项目 ID 和名称。

`entries.json` 是单日的项目数组。新增记录要提供工时、进度和工作内容，修改记录可以只提供变更字段。使用 `--file -` 可从标准输入读取 JSON。

```json
[
  {"projectId": 123, "hours": 3.5, "progress": 60, "content": "完成音频播放联调"},
  {"projectId": 456, "hours": 4.5}
]
```

首次执行 `submit` 会输出改动前后的值和 `previewId`。确认后，用相同日期和输入加上 `--apply`。如果返回 `PREVIEW_STALE`，重新预览。如果返回 `SUBMIT_UNCERTAIN`，先用 `day` 检查是否已保存，再决定是否重新预览。

## AI 调用

执行结果是标准输出中的单行 JSON。二维码和扫码提示写到标准错误，登录令牌保存在本机。AI 可读取退出码以及结果中的 `error.code`，例如 `LOGIN_REQUIRED`、`SESSION_EXPIRED` 或 `NETWORK_ERROR`。

成功退出码为 `0`，执行失败为 `1`，参数无效为 `2`。

```json
{"ok":true,"authenticated":true,"account":{"nickname":"示例用户"}}
```

```json
{"ok":false,"error":{"code":"LOGIN_REQUIRED","message":"请先运行 vela login 完成企微扫码。"}}
```
