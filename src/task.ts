import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { loadSession, saveSession, withSessionLock } from './session.js'
import { asObject, CliError, identityFor, refreshSession, requestWithSession, type Session } from './vela.js'

const catalog = '/pmp/application/app'
const taskApps = '/pmp/dev-task-app'
const invalid = (message: string) => new CliError('INVALID_USAGE', message, 2)

function numericId(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function readList(raw: unknown, section: string): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new CliError('API_ERROR', `VELA 返回的${section}数据格式有误。`)
  }
  return raw
}

async function readPages(session: Session, path: string, section: string) {
  const pageSize = 10
  const rows: Record<string, unknown>[] = []
  let total = 0
  for (let pageNo = 1; pageNo === 1 || rows.length < total; pageNo++) {
    const page = asObject(await requestWithSession(session,
      `${path}&pageNo=${pageNo}&pageSize=${pageSize}`))
    const list = readList(page.list, section)
    if (typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) {
      throw new CliError('API_ERROR', `VELA 返回的${section}总数有误。`)
    }
    if (pageNo === 1) total = page.total
    if (page.total !== total || list.length !== Math.min(pageSize, total - rows.length)) {
      throw new CliError('API_ERROR', `未能完整读取${section}，请重新查询。`)
    }
    rows.push(...list)
  }
  return rows
}

async function readTaskDetail(session: Session, id: string): Promise<Record<string, unknown> & { taskName: string }> {
  const task = asObject(await requestWithSession(session, '/pmp/dev-task/get?id=' + id))
  if (String(task.id) !== id || typeof task.taskName !== 'string') {
    throw new CliError('API_ERROR', 'VELA 未返回有效的开发任务详情。')
  }
  return { ...task, taskName: task.taskName }
}

async function readTaskApps(session: Session, id: string) {
  return readList(await requestWithSession(session, taskApps + '/list?devTaskId=' + id), '关联应用')
}

async function readTask(session: Session, id: string) {
  const task = await readTaskDetail(session, id)
  const [applications, members, plan, attachments, history] = await Promise.all([
    readTaskApps(session, id),
    requestWithSession(session, '/pmp/dev-task-member/list?devTaskId=' + id)
      .then(raw => readList(raw, '开发成员')),
    requestWithSession(session, '/pmp/task/list?businessType=pmp_dev_task&businessId=' + id)
      .then(raw => readList(raw, '开发计划')),
    requestWithSession(session, '/pmp/attachment/list?bizType=pmp_dev_task&bizId=' + id)
      .then(raw => readList(raw, '附件')),
    readPages(session, '/pmp/change-log/page?bizType=pmp_dev_task&bizId=' + id, '变更历史'),
  ])
  return { ok: true, task, applications, members, plan, attachments, history }
}

function parseAppAdd(args: string[]) {
  const usage = '请使用 vela task app add <任务编号> (--app <应用名> | --app-id <应用ID>) [--branch <分支>] [--version <版本>] [--apply <previewId>]。'
  if (args[0] !== 'add') throw invalid(usage)
  const parsed = (() => {
    try {
      return parseArgs({
        args: args.slice(1),
        allowPositionals: true,
        options: {
          app: { type: 'string' },
          'app-id': { type: 'string' },
          branch: { type: 'string' },
          version: { type: 'string' },
          apply: { type: 'string' },
        },
      })
    } catch {
      throw invalid(usage)
    }
  })()
  const { positionals, values } = parsed
  const devTaskId = numericId(positionals[0])
  if (positionals.length !== 1 || devTaskId === undefined) throw invalid(usage)
  const appName = values.app?.trim()
  const appId = numericId(values['app-id'])
  const selector = appName ? { appName } : appId === undefined ? undefined : { appId }
  if ((values.app !== undefined && values['app-id'] !== undefined) || !selector) {
    throw invalid('请通过 --app 提供应用名称，或通过 --app-id 提供应用 ID。')
  }
  const submitGitBranch = values.branch ?? 'dev'
  if (!/^[^\s\x00-\x1f\x7f]+$/.test(submitGitBranch)) throw invalid('--branch 需要有效的 Git 分支名。')
  const { version, apply } = values
  if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) {
    throw invalid('--version 须采用数字.数字.数字格式。')
  }
  if (apply !== undefined && !/^[0-9a-f]{64}$/.test(apply)) throw invalid('--apply 需要有效的 previewId。')
  return { devTaskId, selector, submitGitBranch, version, apply }
}

function catalogApp(raw: unknown) {
  const app = asObject(raw)
  const appId = numericId(app.id)
  if (appId === undefined || typeof app.appName !== 'string' || !app.appName) {
    throw new CliError('API_ERROR', 'VELA 返回的应用目录数据格式有误。')
  }
  return { appId, appName: app.appName }
}

async function resolveApp(session: Session, selector: ReturnType<typeof parseAppAdd>['selector']) {
  if (selector.appId !== undefined) {
    const app = catalogApp(await requestWithSession(session, catalog + '/get?id=' + selector.appId))
    if (app.appId !== selector.appId) throw new CliError('API_ERROR', 'VELA 返回了其他应用。')
    return app
  }
  const query = new URLSearchParams({ appName: selector.appName })
  const apps = (await readPages(session, catalog + '/page?' + query, '应用目录')).map(catalogApp)
  const exact = apps.filter(app => app.appName === selector.appName)
  if (exact.length === 1) return exact[0]
  const candidates = exact.length ? exact : apps
  if (!candidates.length) throw new CliError('APP_NOT_FOUND', '应用目录中没有匹配的应用。')
  const choices = candidates.slice(0, 10).map(app => `${app.appName} (#${app.appId})`).join('、')
  const reason = exact.length ? '找到多个同名应用' : '未找到名称完全匹配的应用'
  const more = candidates.length > 10 ? `等 ${candidates.length} 个` : ''
  throw new CliError(exact.length ? 'APP_AMBIGUOUS' : 'APP_NOT_FOUND',
    `${reason}。候选应用为 ${choices}${more}，请使用 --app-id 指定。`)
}

async function prepareAppAdd(session: Session, input: ReturnType<typeof parseAppAdd>) {
  const id = String(input.devTaskId)
  const [task, app, links, account] = await Promise.all([
    readTaskDetail(session, id),
    resolveApp(session, input.selector),
    readTaskApps(session, id),
    identityFor(session),
  ])
  const { devTaskId, submitGitBranch, version } = input
  if (links.some(link => numericId(link.appId) === app.appId)) {
    throw new CliError('APP_ALREADY_LINKED', `应用「${app.appName}」已关联到任务 #${devTaskId}。`)
  }
  const taskApp = { devTaskId, taskName: task.taskName, ...app, submitGitBranch, version }
  const previewId = createHash('sha256').update(JSON.stringify(['task-app-add', account.id, taskApp])).digest('hex')
  return { taskApp, previewId }
}

export type TaskDetails = Awaited<ReturnType<typeof readTask>>
type TaskAppPreview = Awaited<ReturnType<typeof prepareAppAdd>>
export type TaskAppResult =
  | ({ ok: true; submitted: false } & TaskAppPreview)
  | { ok: true; submitted: true; taskApp: TaskAppPreview['taskApp']; association: Record<string, unknown> }

export async function taskCommand(args: string[]) {
  const [command, id] = args
  const add = command === 'app' ? parseAppAdd(args.slice(1)) : undefined
  if (!add && (args.length !== 2 || command !== 'get' || !/^[1-9]\d*$/.test(id))) {
    throw invalid('请使用 vela task get <任务编号> 或 vela task app add，运行 vela task 查看帮助。')
  }

  return withSessionLock(async (): Promise<TaskDetails | TaskAppResult> => {
    let session = await loadSession()
    let refreshed = false
    async function read<T>(operation: (active: Session) => Promise<T>): Promise<T> {
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

    if (!add) return read(active => readTask(active, id))
    const preview = await read(active => prepareAppAdd(active, add))
    if (add.apply === undefined) return { ok: true, submitted: false, ...preview }
    if (add.apply !== preview.previewId) {
      throw new CliError('PREVIEW_STALE', '账号、任务或添加参数已变化，请重新预览。')
    }

    const { devTaskId, appId, submitGitBranch, version } = preview.taskApp
    try {
      const result = await requestWithSession(session, taskApps + '/create', { devTaskId, appId, submitGitBranch, version })
      if (result === false) throw new CliError('API_ERROR', 'VELA 未接受本次应用关联。')
    } catch (error) {
      if (!(error instanceof CliError) || !['NETWORK_ERROR', 'SUBMIT_UNCERTAIN'].includes(error.code)) throw error
      // The association may already exist. Reconcile with a read and never replay the POST.
    }

    const links = await read(active => readTaskApps(active, String(devTaskId))).catch(() => undefined)
    const link = links?.find(item => numericId(item.appId) === appId
      && item.submitGitBranch === submitGitBranch && (version === undefined || item.version === version))
    if (!link) {
      throw new CliError('SUBMIT_UNCERTAIN', '回查未能确认应用关联，请先用 vela task get 核对任务，再决定是否重新预览。')
    }
    return { ok: true, submitted: true, taskApp: preview.taskApp, association: link }
  })
}
