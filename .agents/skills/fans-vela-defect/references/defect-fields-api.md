# 用 VELA API 补齐缺陷字段

CLI 缺少缺陷字段编辑能力时使用本页。在用户已授权提交该流转的情况下，这一步用于保存流转所需字段。预览请求只读取字段和字典。

API 基址为 `https://vela-api.up366demo.cn/admin-api`。优先复用 VELA CLI 的 `session.ts`（`withSessionLock`、`loadSession`）和 `vela.ts`（`identityFor`、`requestWithSession`）。当前 CLI 会话路径为 `${XDG_STATE_HOME}/.vela/auth.json`（设置该环境变量时）或 `~/.vela/auth.json`。使用本机会话中的访问令牌访问同一 VELA API，避免把令牌放进命令参数、日志或回复。临时文件如需保存缺陷原始详情，应限制权限并及时清理。

| 请求 | 用途 |
| --- | --- |
| `GET /system/auth/get-permission-info` | 从 `data.user` 取当前登录用户的 `id` 和 `nickname`。 |
| `GET /system/dict-data/simple-list` | 在 `data` 中按 `dictType=pmp_defect_resolution` 和 `label=已修复` 查找唯一字典项，将 `value` 转为整数。 |
| `GET /pmp/defect/get?id=<缺陷编号>` | 读取更新前的原始详情和更新后的字段值。 |
| `PUT /pmp/defect/update` | 保存必填字段。可用 `requestWithSession(session, '/pmp/defect/update', body, 'PUT')`。 |
| `GET /pmp/defect/action-list?id=<缺陷编号>` | 确认目标动作仍可执行，且 `missingRequiredFields` 已清空。 |

1. 用 API 读取最新详情，核对缺陷 ID、当前状态、处理人和目标动作与拟流转内容一致。按技能默认值补齐空字段，按用户明确指定的值修改对应字段。常见字段为整数 `resolution`、`fixUserId`、`ownerUserId` 和日期字符串 `handleTime`。日期按用户时区生成 `YYYY-MM-DD`，回读时可收到 `[年, 月, 日]`。
2. 构造 JSON 正文时，沿用详情页的写法，以最新 `GET /pmp/defect/get` 的原始 `data` 为基础，只覆盖本次需要保存的字段。用原始对象保留服务端已有字段，避免使用 CLI 展示层整理过的对象。接口只负责保存字段，状态、处理人和备注随后由 CLI 流转命令提交。
3. 保存后回读详情和动作列表，逐项核对实际保存值以及当前动作。若保存超时或结果不明确，先回查，再根据缺失字段决定是否重试。已补齐时回到技能的 `vela defect transition` 预览和 `--apply` 流程。
