import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseArgs, TextDecoder } from 'node:util'
import { loadSession, saveSession, withSessionLock } from './session.js'
import { asObject, CliError, identityFor, refreshSession, requestWithSession } from './vela.js'

const reports = '/pmp/daily-report'

type ProjectId = number | string
export type Project = { projectId: ProjectId; projectName: string }
type Fields = { hours: number; progress: number; content: string }
type Card = Project & {
  filled: boolean
  hours: number | null
  progress: number | null
  content: string | null
  todoHours: number
}
export type DayReport = { date: string; totalHours: number | null; cards: Card[] }
type Entry = { projectId: string } & Partial<Fields>

const invalid = (message: string) => new CliError('INVALID_USAGE', message, 2)
const badResponse = () => new CliError('API_ERROR', 'VELA 返回的日报数据格式有误。')
const projectKey = (id: ProjectId) => String(id)
const compareIds = (a: { projectId: ProjectId }, b: { projectId: ProjectId }) =>
  projectKey(a.projectId).localeCompare(projectKey(b.projectId), 'en')

function isProjectId(id: unknown): id is ProjectId {
  return typeof id === 'number' ? Number.isSafeInteger(id) && id > 0
    : typeof id === 'string' && /^[1-9]\d*$/.test(id)
}

function readProjects<T extends Project>(
  raw: unknown,
  parse: (project: Project, item: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(raw)) throw badResponse()
  const ids = new Set<string>()
  return raw.map(value => {
    const item = asObject(value)
    const { projectId, projectName } = item
    if (!isProjectId(projectId) || typeof projectName !== 'string' || ids.has(projectKey(projectId))) {
      throw badResponse()
    }
    ids.add(projectKey(projectId))
    return parse({ projectId, projectName }, item)
  })
}

function parseCards(raw: unknown): Card[] {
  return readProjects(raw, (project, item) => {
    if (typeof item.filled !== 'boolean') throw badResponse()
    const { filled } = item
    const manual = item.manualWorkHours ?? item.workHours
    const todo = item.todoWorkHours ?? 0
    if (typeof todo !== 'number' || !Number.isFinite(todo) || todo < 0) throw badResponse()
    return {
      ...project,
      filled,
      hours: filled && typeof manual === 'number' && Number.isFinite(manual) && manual >= 0 ? manual : null,
      progress: filled && typeof item.progress === 'number' ? item.progress : null,
      content: filled && typeof item.content === 'string' ? item.content : null,
      todoHours: filled ? todo : 0,
    }
  })
}

function dayResult(date: string, cards: Card[]): DayReport {
  const total = cards.reduce((sum, card) => sum + (card.hours ?? 0) + card.todoHours, 0)
  return {
    date,
    totalHours: cards.some(card => card.filled && card.hours === null) ? null : Number(total.toFixed(10)),
    cards,
  }
}

function parseEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('工时输入必须是非空的 JSON 数组。')
  const ids = new Set<string>()
  return raw.map(value => {
    const item = asObject(value)
    const { projectId, hours, progress, content } = item
    if (!isProjectId(projectId) || ids.has(projectKey(projectId))) {
      throw invalid('每项必须提供有效且不重复的 projectId。')
    }
    if (Object.keys(item).some(key => !['projectId', 'hours', 'progress', 'content'].includes(key))) {
      throw invalid('工时输入只接受 projectId、hours、progress 和 content。')
    }
    const id = projectKey(projectId)
    ids.add(id)
    const entry: Entry = { projectId: id }
    if (hours !== undefined) {
      if (typeof hours !== 'number' || hours < 0.5 || hours > 24 || !Number.isInteger(hours * 2)) {
        throw invalid(`项目 ${id} 的工时必须是 0.5–24 小时，按 0.5 小时递增。`)
      }
      entry.hours = hours
    }
    if (progress !== undefined) {
      if (typeof progress !== 'number' || !Number.isInteger(progress) || progress < 0 || progress > 100) {
        throw invalid(`项目 ${id} 的进度必须是 0–100 的整数。`)
      }
      entry.progress = progress
    }
    if (content !== undefined) {
      if (typeof content !== 'string' || content.trim().length === 0 || content.trim().length > 1000) {
        throw invalid(`项目 ${id} 的工作内容必须为 1–1000 字。`)
      }
      entry.content = content.trim()
    }
    if (Object.keys(entry).length === 1) throw invalid(`项目 ${id} 至少需要提供一个工时字段。`)
    return entry
  }).sort(compareIds)
}

async function readEntries(path: string) {
  let raw: unknown
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let input = ''
    if (path === '-') {
      for await (const chunk of process.stdin) input += decoder.decode(chunk, { stream: true })
      input += decoder.decode()
    } else {
      input = decoder.decode(await readFile(path))
    }
    raw = JSON.parse(input)
  } catch {
    throw invalid('无法读取工时输入，请提供有效的 UTF-8 JSON。')
  }
  return parseEntries(raw)
}

function existingFields(card: Card): Fields {
  const { hours, progress, content } = card
  if (hours === null || progress === null || !Number.isInteger(progress)
      || progress < 0 || progress > 100 || content === null || !content.trim()) {
    throw new CliError('INCOMPLETE_REPORT', `项目「${card.projectName}」的已有记录不完整，无法安全合并。`)
  }
  return { hours, progress, content }
}

function sameFields(a: Fields, b: Fields) {
  return a.hours === b.hours && a.progress === b.progress && a.content === b.content
}

function prepare(date: string, accountId: string, entries: Entry[], cards: Card[], projects: Project[]) {
  const current = new Map(cards.map(card => [projectKey(card.projectId), card]))
  const eligible = new Map(projects.map(project => [projectKey(project.projectId), project]))
  const items = new Map<string, Project & Fields>()
  for (const card of cards) {
    if (card.filled) {
      const { projectId, projectName } = card
      items.set(projectKey(projectId), { projectId, projectName, ...existingFields(card) })
    }
  }
  const changes = entries.flatMap(({ projectId, ...fields }) => {
    const project = current.get(projectId) ?? eligible.get(projectId)
    if (!project) throw invalid(`项目 ${projectId} 不在当天卡片或可填报项目中。`)
    const before = items.get(projectId)
    const hours = fields.hours ?? before?.hours
    const progress = fields.progress ?? before?.progress
    const content = fields.content ?? before?.content
    if (hours === undefined || progress === undefined || content === undefined) {
      throw invalid(`新增项目「${project.projectName}」需要工时、进度和工作内容。`)
    }
    const after = { hours, progress, content }
    if (before && sameFields(before, after)) return []
    const meta = { projectId: project.projectId, projectName: project.projectName }
    items.set(projectId, { ...meta, ...after })
    return [{
      ...meta, action: before ? 'update' : 'create',
      before: before ? { hours: before.hours, progress: before.progress, content: before.content } : null,
      after,
    }]
  })
  const expected = [...items.values()].sort(compareIds)
  const baseline = cards.filter(card => card.filled || entries.some(entry => entry.projectId === projectKey(card.projectId)))
    .sort(compareIds)
  const previewId = createHash('sha256').update(JSON.stringify([accountId, date, entries, baseline, expected])).digest('hex')
  return { changes, expected, previewId }
}

function checkedDate(value: string | undefined, required: boolean) {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  if (!required && value === undefined) return today
  if (!value || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw invalid('请用 --date YYYY-MM-DD 指定有效日期。')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid('请指定有效的日历日期。')
  }
  if (required && value > today) throw invalid('填报日期不能晚于北京时间当天。')
  return value
}

export async function hoursCommand(args: string[]) {
  const [command, ...rest] = args
  if (command !== 'day' && command !== 'projects' && command !== 'submit') {
    throw invalid('请使用 vela hours day、projects 或 submit。')
  }
  let values: { date?: string; file?: string; apply?: string }
  try {
    const date = { type: 'string' } as const
    values = parseArgs({
      args: rest,
      options: command === 'submit' ? { date, file: { type: 'string' }, apply: { type: 'string' } }
        : command === 'day' ? { date } : {},
    }).values
  } catch {
    throw invalid('工时命令参数无效，请运行 vela --help。')
  }
  const date = command === 'projects' ? '' : checkedDate(values.date, command === 'submit')
  if (command === 'submit' && !values.file) throw invalid('请使用 --file 指定 JSON 文件或用 - 从标准输入读取。')
  if (values.apply !== undefined && !/^[0-9a-f]{64}$/.test(values.apply)) throw invalid('--apply 需要有效的 previewId。')
  const entries = values.file ? await readEntries(values.file) : []

  return withSessionLock(async () => {
    let session = await loadSession()
    let refreshed = false
    async function read<T>(operation: (active: typeof session) => Promise<T>): Promise<T> {
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

    const getProjects = () => read(active => requestWithSession(active, reports + '/reportable-project-list'))
      .then(raw => readProjects(raw, project => project))
    if (command === 'projects') return { ok: true, projects: await getProjects() }
    const getCards = () => read(active => requestWithSession(active, reports + '/my-card-list?date=' + date))
      .then(parseCards)
    const cards = await getCards()
    if (command === 'day') return { ok: true, ...dayResult(date, cards) }
    const account = await read(identityFor)
    const needsProjects = entries.some(entry => !cards.some(card => projectKey(card.projectId) === entry.projectId))
    const { changes, expected, previewId } = prepare(date, account.id, entries, cards, needsProjects ? await getProjects() : [])
    if (values.apply === undefined) return { ok: true, submitted: false, date, previewId, changes }
    if (values.apply !== previewId) throw new CliError('PREVIEW_STALE', '填报内容或服务端记录已变化，请重新预览。')
    if (changes.length === 0) return { ok: true, submitted: false, ...dayResult(date, cards) }

    try {
      const result = await requestWithSession(session, reports + '/submit', {
        reportDate: date,
        items: expected.map(({ projectId, hours, progress, content }) => ({ projectId, workHours: hours, progress, content })),
      })
      if (result === false) throw new CliError('API_ERROR', 'VELA 未接受本次工时提交。')
    } catch (error) {
      if (!(error instanceof CliError) || !['NETWORK_ERROR', 'SUBMIT_UNCERTAIN'].includes(error.code)) throw error
      // The server may already have saved the records. Never replay this POST.
    }
    const saved = await getCards().catch(() => undefined)
    const savedById = new Map(saved?.filter(card => card.filled).map(card => [projectKey(card.projectId), card]))
    const confirmed = expected.every(item => {
      const card = savedById.get(projectKey(item.projectId))
      return card?.hours === item.hours && card.progress === item.progress && card.content === item.content
    })
    if (!saved || !confirmed) {
      throw new CliError('SUBMIT_UNCERTAIN', '回查未能确认提交结果，请核对当天记录后重新预览。')
    }
    return { ok: true, submitted: true, ...dayResult(date, saved) }
  })
}
