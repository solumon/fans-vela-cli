---
name: fans-vela-defect
description: 在 VELA 缺陷列表（vela.up366demo.cn/pmp/defect）查询当前由本人处理的缺陷、查看指定缺陷详情并排查相关项目代码、查询历史、预览并提交转交或状态流转。用户发送 VELA 缺陷详情链接（包括只说「看一下」），或明确提到 VELA 缺陷、PMS 缺陷列表、vela defect 时使用。
---

# VELA 缺陷

使用项目提供的 `vela defect` 和当前 CLI 登录会话。调用时加 `--json`，根据 `ok`、`submitted` 和 `error.code` 判断结果。若返回 `LOGIN_REQUIRED` 或 `SESSION_EXPIRED`，请用户在终端运行 `vela login` 完成扫码。若当前版本没有 `defect` 子命令，提示更新 VELA CLI。

## 查询

- `vela defect list --json` 查询当前处理人为登录账号的缺陷，默认包含所有状态。用户指定状态时加 `--status <状态名或编号>`。结果包含 `page`、`pageSize` 和 `total`，按需用 `--page` 翻页，每页最多 100 条。只展示部分结果时说明范围。
- `vela defect get <缺陷编号> --json` 读取详情、附件清单和可用动作。用户需要历史或要核对流转时加 `--history`，读取 `transitionHistory` 和 `changeHistory`。
- 用户只给标题时，可以翻页查找本人列表，确认唯一匹配后再选定缺陷。有多个候选时列出编号和标题供选择。范围无法覆盖用户描述的缺陷时，请用户提供编号。

## 单条缺陷排查

- 用户提供详情链接时，从 `/pmp/defect/detail?id=...` 取缺陷编号，直接用 CLI 查询。用户只发链接或说「看一下」「查一下」时，查到详情后在同一轮继续做只读代码排查。用户明确只要详情、历史、列表或流转时，按指定范围处理。
- 优先检查当前工作区，从缺陷里的项目、端、页面、复现条件和界面文案定位入口、组件及相关样式或状态逻辑。当前项目不匹配时，查找可访问的相关仓库；找不到或无法确定仓库时，汇报已知详情和缺口，请用户提供仓库路径。
- 核对代码能否解释缺陷现象。有现成的测试或可用的本地复现入口时，按需验证。汇报缺陷状态、代码结论和关键文件行号，明确区分代码推断、已复现和证据不足。查看请求只做排查，修复或流转按用户的明确要求执行。摘要不要回显缺陷描述中的账号密码或附件签名。

## 流转

1. 先读详情，从 `actions` 确认当前账号可执行的动作、`targetStatusName`、候选处理人及必填要求。只转交时使用 `--to <VELA 用户 ID>`，省略 `--status`。变更状态时用 `--status <状态名或编号>`，动作的 `handlerRequired` 为真时须指定处理人。如果 `handlerCandidateUserIds` 非空，目标 ID 必须在其中。只知道姓名且缺陷数据无法唯一确定 VELA 用户 ID 时，请用户补充 ID。收到 `DEFECT_FIELDS_REQUIRED` 时，列出字段并提示用户先在 VELA 缺陷详情页补齐。
2. 用 `vela defect transition <缺陷编号> [--status <状态>] [--to <用户ID>] [--message <备注>] --json` 生成预览，核对缺陷编号、动作、状态和处理人前后值及备注。备注按用户提供的内容作为一个参数安全传递。用户要求预览或尚未明确授权这项具体操作时，展示预览并等待确认。已有明确授权时，核对预览与授权一致后，使用相同参数加 `--apply <previewId>`。
3. `submitted: true` 表示 CLI 已回查确认。用返回的 `defect` 汇报最终状态和处理人。遇到 `PREVIEW_STALE` 时重新读取并生成预览，若变化超出原授权范围，请用户确认新的预览。遇到 `SUBMIT_UNCERTAIN` 时，先用 `vela defect get <缺陷编号> --history --json` 核对当前状态和最新流转记录，说明能确认的结果，避免自动重发。
