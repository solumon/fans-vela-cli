import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { loadSession, saveSession, withSessionLock } from './session.js'
import { asObject, CliError, identityFor, refreshSession, requestWithSession, type Session } from './vela.js'

const defectPath = '/pmp/defect'
const transitionLogPath = '/fsm/transition-log/page'
const historyPageSize = 10
const invalid = (message: string) => new CliError('INVALID_USAGE', message, 2)
type Row = Record<string, unknown>
type Read = <T>(operation: (session: Session) => Promise<T>) => Promise<T>

function integer(value: unknown, min: number) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= min ? number : undefined
}

function readRows(raw: unknown, section: string): Row[] {
  if (!Array.isArray(raw) || raw.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new CliError('API_ERROR', `VELA 返回的${section}格式有误。`)
  }
  return raw
}

async function readPage(session: Session, path: string, query: URLSearchParams, section: string) {
  const page = asObject(await requestWithSession(session, path + '?' + query))
  const total = integer(page.total, 0)
  if (total === undefined) throw new CliError('API_ERROR', `VELA 返回的${section}总数有误。`)
  return { total, list: readRows(page.list, section) }
}

function defectQuery(id: number) {
  return new URLSearchParams({ bizType: 'pmp_defect', bizId: String(id) })
}

function historyPage(session: Session, path: string, id: number, page: number) {
  const query = defectQuery(id)
  query.set('pageNo', String(page))
  query.set('pageSize', String(historyPageSize))
  return readPage(session, path, query, '历史记录')
}

async function readHistory(session: Session, path: string, id: number) {
  const first = await historyPage(session, path, id, 1)
  const list: Row[] = []
  const seenIds = new Set<number>()
  for (let page = 1; page === 1 || list.length < first.total; page++) {
    const current = page === 1 ? first : await historyPage(session, path, id, page)
    if (current.total !== first.total || current.list.length !== Math.min(historyPageSize, first.total - list.length)) {
      throw new CliError('API_ERROR', '未能完整读取历史记录，请重新查询。')
    }
    for (const row of current.list) {
      const id = integer(row.id, 1)
      if (id === undefined || seenIds.has(id)) {
        throw new CliError('API_ERROR', '历史记录在查询期间发生变化，请重新查询。')
      }
      seenIds.add(id)
      list.push(row)
    }
  }
  return list
}

async function readStatuses(session: Session) {
  const rows = readRows(await requestWithSession(session, defectPath + '/status-list'), '缺陷状态')
  const statuses = new Map<number, string>()
  for (const row of rows) {
    const status = integer(row.status, 0)
    if (status === undefined || typeof row.name !== 'string' || !row.name) {
      throw new CliError('API_ERROR', 'VELA 返回了无效的缺陷状态。')
    }
    statuses.set(status, row.name)
  }
  return statuses
}

function resolveStatus(statuses: Map<number, string>, selector: string) {
  const matches = [...statuses].filter(([id, name]) => String(id) === selector || name === selector)
  if (matches.length !== 1) {
    const names = [...statuses.values()].join('、')
    throw invalid(`无法唯一匹配状态「${selector}」。可用状态：${names || '无'}。`)
  }
  return matches[0][0]
}

const severityNames = new Map([[1, '阻塞'], [2, '严重'], [3, '一般'], [4, '轻微']])

function parseDefect(raw: unknown) {
  const row = asObject(raw)
  const id = integer(row.id, 1)
  const status = integer(row.status, 0)
  if (id === undefined || status === undefined || typeof row.title !== 'string') {
    throw new CliError('API_ERROR', 'VELA 返回了无效的缺陷信息。')
  }
  return { ...row, id, status, title: row.title }
}

function labelDefect(defect: ReturnType<typeof parseDefect>, statuses: Map<number, string>) {
  const row: Row = defect
  return {
    ...defect,
    statusName: statuses.get(defect.status) ?? String(defect.status),
    severityName: severityNames.get(integer(row.severity, 1) ?? 0),
  }
}

async function readDefect(session: Session, id: number) {
  const raw = await requestWithSession(session, defectPath + '/get?id=' + id)
  if (raw === null) throw new CliError('DEFECT_NOT_FOUND', `未找到缺陷 #${id}。`)
  const defect = parseDefect(raw)
  if (defect.id !== id) throw new CliError('API_ERROR', 'VELA 返回了其他缺陷。')
  return defect
}

async function readActions(session: Session, id: number) {
  const rows = readRows(await requestWithSession(session, defectPath + '/action-list?id=' + id), '缺陷流转动作')
  return rows.map(row => {
    const { event, eventName, permitted, handlerRequired } = row
    const toState = integer(row.toState, 0)
    const candidates = row.handlerCandidateUserIds ?? []
    if (typeof event !== 'string' || !event || toState === undefined || typeof permitted !== 'boolean'
      || typeof handlerRequired !== 'boolean' || !Array.isArray(candidates)
      || candidates.some(id => integer(id, 1) === undefined)) {
      throw new CliError('API_ERROR', 'VELA 返回了无效的缺陷流转动作。')
    }
    const missingFields = readRows(row.missingRequiredFields ?? [], '流转必填字段')
    return {
      event, eventName: typeof eventName === 'string' ? eventName : event,
      toState, permitted, handlerRequired, handlerCandidateUserIds: candidates.map(Number).sort((a, b) => a - b),
      missingRequiredFields: missingFields,
    }
  })
}

async function listDefects(session: Session, page: number, pageSize: number, status?: string) {
  const [account, statuses] = await Promise.all([identityFor(session), readStatuses(session)])
  const query = new URLSearchParams({
    pageNo: String(page), pageSize: String(pageSize), 'handlerUserIds[0]': account.id,
  })
  if (status !== undefined) query.set('statusList[0]', String(resolveStatus(statuses, status)))
  const { total, list } = await readPage(session, defectPath + '/page', query, '缺陷列表')
  return { ok: true as const, defects: list.map(row => labelDefect(parseDefect(row), statuses)), page, pageSize, total }
}

async function getDefect(session: Session, id: number, history: boolean) {
  const defect = await readDefect(session, id)
  const [statuses, actions, attachments, records] = await Promise.all([
    readStatuses(session),
    readActions(session, id),
    requestWithSession(session, '/pmp/attachment/list?' + defectQuery(id))
      .then(raw => readRows(raw, '缺陷附件')),
    history ? Promise.all([
      readHistory(session, transitionLogPath, id),
      readHistory(session, '/pmp/change-log/page', id),
    ]) : undefined,
  ])
  return {
    ok: true as const, defect: labelDefect(defect, statuses), attachments,
    actions: actions.filter(action => action.permitted).map(action => ({
      ...action, targetStatusName: statuses.get(action.toState) ?? String(action.toState),
    })),
    ...(records ? { transitionHistory: records[0], changeHistory: records[1] } : {}),
  }
}

function toRemarkHtml(message: string) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return message.split('\n').map(line => `<p>${line.replace(/[&<>"']/g, char => entities[char]) || '<br>'}</p>`).join('')
}

type TransitionInput = { id: number; status?: string; to?: number; message?: string; apply?: string }

async function readAssignee(session: Session, id: number) {
  const users = readRows(await requestWithSession(session, '/system/user/simple-list'), 'VELA 用户列表')
  const user = users.find(user => integer(user.id, 1) === id)
  if (!user || typeof user.nickname !== 'string') {
    throw new CliError('DEFECT_HANDLER_NOT_FOUND', `找不到处理人 #${id}，请核对 VELA 用户 ID。`)
  }
  return { id, name: user.nickname }
}

async function prepareTransition(session: Session, { id, status, to, message }: TransitionInput) {
  const defect = await readDefect(session, id)
  const [account, statuses, actions, recent] = await Promise.all([
    identityFor(session), readStatuses(session), readActions(session, id),
    historyPage(session, transitionLogPath, id, 1),
  ])
  const target = status === undefined ? defect.status : resolveStatus(statuses, status)
  const action = status === undefined
    ? actions.find(action => action.event === 'handoff' && action.toState === target)
    : actions.find(action => action.event !== 'handoff' && action.toState === target && action.permitted)
  if (!action?.permitted || (status !== undefined && target === defect.status)) {
    throw new CliError('DEFECT_TRANSITION_NOT_ALLOWED', '当前账号不能执行该流转，请用 vela defect get 查看可用动作。')
  }
  if (action.missingRequiredFields.length) {
    const fields = action.missingRequiredFields.map(field => field.label ?? field.key).join('、')
    throw new CliError('DEFECT_FIELDS_REQUIRED', `请先在 VELA 缺陷详情补齐流转必填字段：${fields}。`)
  }
  if ((status === undefined || action.handlerRequired) && to === undefined) {
    throw invalid('该流转需要用 --to 指定处理人 ID。')
  }
  const row: Row = defect
  const currentHandlerId = integer(row.handlerUserId, 1)
  if (to !== undefined && action.handlerCandidateUserIds.length && !action.handlerCandidateUserIds.includes(to)) {
    throw new CliError('DEFECT_HANDLER_NOT_ALLOWED', '指定的处理人不在该动作的候选范围内，请用 vela defect get 查看候选 ID。')
  }
  const assignee = to === undefined ? undefined : await readAssignee(session, to)
  const latestLogId = recent.list.reduce((max, log) => {
    const id = integer(log.id, 1)
    if (id === undefined) throw new CliError('API_ERROR', 'VELA 返回了无效的流转历史编号。')
    return Math.max(max, id)
  }, 0)
  if (recent.list.length !== Math.min(historyPageSize, recent.total)) {
    throw new CliError('API_ERROR', '未能读取最新流转历史。')
  }
  const transition = {
    id, title: defect.title, event: action.event, eventName: action.eventName,
    before: {
      status: defect.status, statusName: statuses.get(defect.status) ?? String(defect.status),
      handlerId: currentHandlerId, handlerName: typeof row.handlerNickname === 'string' ? row.handlerNickname : undefined,
    },
    after: {
      status: target, statusName: statuses.get(target) ?? String(target),
      handlerId: assignee?.id, handlerName: assignee?.name,
    },
    message,
  }
  const payload = {
    id, event: action.event, targetState: String(target), handlerUserId: assignee?.id,
    remarkHtml: message === undefined ? undefined : toRemarkHtml(message),
  }
  const previewId = createHash('sha256')
    .update(JSON.stringify(['defect-transition', account.id, transition, action, latestLogId]))
    .digest('hex')
  return { transition, payload, previewId, latestLogId, actorId: account.id }
}

type TransitionPreview = Awaited<ReturnType<typeof prepareTransition>>

async function reconcileTransition(session: Session, preview: TransitionPreview) {
  const { transition, latestLogId, actorId, payload } = preview
  const [defect, logs] = await Promise.all([
    readDefect(session, transition.id),
    historyPage(session, transitionLogPath, transition.id, 1),
  ])
  const row: Row = defect
  if (defect.status !== transition.after.status
    || (payload.handlerUserId !== undefined && integer(row.handlerUserId, 1) !== payload.handlerUserId)) return
  const matching = logs.list.filter(log => (integer(log.id, 1) ?? 0) > latestLogId
    && log.event === payload.event && String(log.creator) === actorId
    && integer(log.fromState, 0) === transition.before.status && integer(log.toState, 0) === transition.after.status
    && (payload.handlerUserId === undefined || integer(log.handlerUserId, 1) === payload.handlerUserId))
  if (matching.length === 1) {
    return { defect: { ...defect, statusName: transition.after.statusName }, log: matching[0] }
  }
}

export type DefectResult =
  | Awaited<ReturnType<typeof listDefects>>
  | Awaited<ReturnType<typeof getDefect>>
  | { ok: true; submitted: false; transition: TransitionPreview['transition']; previewId: string }
  | { ok: true; submitted: true; transition: TransitionPreview['transition']; defect: Row; log: Row }

async function transitionDefect(input: TransitionInput, read: Read, session: () => Session): Promise<DefectResult> {
  const stale = () => new CliError('PREVIEW_STALE', '账号、缺陷或流转参数已变化，请重新预览。')
  const preview = await read(active => prepareTransition(active, input)).catch((error: unknown) => {
    if (input.apply && error instanceof CliError && [
      'INVALID_USAGE', 'DEFECT_NOT_FOUND', 'DEFECT_FIELDS_REQUIRED', 'DEFECT_TRANSITION_NOT_ALLOWED',
      'DEFECT_HANDLER_NOT_ALLOWED', 'DEFECT_HANDLER_NOT_FOUND',
    ].includes(error.code)) throw stale()
    throw error
  })
  const { transition, previewId, payload } = preview
  if (!input.apply) return { ok: true, submitted: false, transition, previewId }
  if (input.apply !== previewId) throw stale()

  try {
    const result = await requestWithSession(session(), defectPath + '/change-status', payload, 'PUT')
    if (result === false) throw new CliError('API_ERROR', 'VELA 未接受本次流转。')
  } catch (error) {
    if (!(error instanceof CliError) || !['NETWORK_ERROR', 'SUBMIT_UNCERTAIN'].includes(error.code)) throw error
  }
  const confirmed = await read(active => reconcileTransition(active, preview)).catch(() => undefined)
  if (!confirmed) {
    throw new CliError('SUBMIT_UNCERTAIN', `回查未能确认流转，请先用 vela defect get ${input.id} --history 核对。`)
  }
  return { ok: true, submitted: true, transition, ...confirmed }
}

function parseCommand([command, ...args]: string[]) {
  function parse<T extends Record<string, { type: 'string' | 'boolean' }>>(options: T, usage: string) {
    try {
      return parseArgs({ args, options, allowPositionals: true })
    } catch {
      throw invalid(usage)
    }
  }
  if (command === 'list') {
    const usage = '请使用 vela defect list [--status <状态>] [--page <页码>] [--page-size <条数>]。'
    const { values, positionals } = parse({
      status: { type: 'string' }, page: { type: 'string' }, 'page-size': { type: 'string' },
    }, usage)
    const page = integer(values.page ?? '1', 1)
    const pageSize = integer(values['page-size'] ?? '50', 1)
    const status = values.status?.trim()
    if (positionals.length || page === undefined || pageSize === undefined || pageSize > 100 || status === '') {
      throw invalid(usage)
    }
    return { command, page, pageSize, status } as const
  }
  if (command === 'get') {
    const usage = '请使用 vela defect get <缺陷编号> [--history]。'
    const { values, positionals } = parse({ history: { type: 'boolean' } }, usage)
    const id = integer(positionals[0], 1)
    if (positionals.length !== 1 || id === undefined) throw invalid(usage)
    return { command, id, history: values.history ?? false } as const
  }
  if (command === 'transition') {
    const usage = '请使用 vela defect transition <缺陷编号> [--status <状态>] [--to <用户ID>] [--message <备注>] [--apply <previewId>]。'
    const { values, positionals } = parse({
      status: { type: 'string' }, to: { type: 'string' }, message: { type: 'string' }, apply: { type: 'string' },
    }, usage)
    const id = integer(positionals[0], 1)
    const to = integer(values.to, 1)
    const status = values.status?.trim()
    const message = values.message?.replace(/\r\n?/g, '\n').trim()
    if (positionals.length !== 1 || id === undefined || (values.to !== undefined && to === undefined)
      || status === '' || (status === undefined && to === undefined)
      || (values.apply !== undefined && !/^[0-9a-f]{64}$/.test(values.apply))) throw invalid(usage)
    return { command, id, status, to, message: message || undefined, apply: values.apply } as const
  }
  throw invalid('请使用 vela defect list、get 或 transition，运行 vela defect 查看帮助。')
}

export async function defectCommand(args: string[]): Promise<DefectResult> {
  const input = parseCommand(args)
  return withSessionLock(async () => {
    let session = await loadSession()
    let refreshed = false
    const read: Read = async operation => {
      try {
        return await operation(session)
      } catch (error) {
        if (!(error instanceof CliError) || error.code !== 'SESSION_EXPIRED' || refreshed) throw error
        refreshed = true
        session = await refreshSession(session)
        await saveSession(session)
        return operation(session)
      }
    }
    if (input.command === 'list') return read(active => listDefects(active, input.page, input.pageSize, input.status))
    if (input.command === 'get') return read(active => getDefect(active, input.id, input.history))
    return transitionDefect(input, read, () => session)
  })
}
