#!/usr/bin/env node
import { parseArgs, stripVTControlCharacters } from 'node:util'
import Table from 'cli-table3'
import { browserLogin } from './browser-login.js'
import { hoursCommand, type Project } from './hours.js'
import { clearSession, loadSession, saveSession, withSessionLock } from './session.js'
import { accountFor, CliError, logoutSession, refreshSession } from './vela.js'

const help = `用法
  vela login [--timeout 秒] [--browser]   显示企微扫码登录二维码
  vela auth status            查询当前登录账号，必要时刷新会话
  vela logout                 退出登录并清除本地会话
  vela hours day [--date YYYY-MM-DD]     查询日报和工时
  vela hours projects [--json]          查询可填报项目
  vela hours submit --date YYYY-MM-DD --file <文件|-> [--apply <previewId>]
  vela --help                 显示帮助

默认在终端显示二维码，使用 --browser 可改在 Chrome 中显示。扫码默认等待 180 秒。
命令结果以 JSON 写到标准输出。projects 在交互终端显示表格，可用 --json 输出 JSON。
扫码提示写到标准错误。
`

function formatProjects(projects: Project[], columns: number | undefined) {
  if (projects.length === 0) return '暂无可填报项目。'

  const table = new Table({
    head: ['项目 ID', '项目名'],
    style: { compact: true, head: [], border: [] },
  })
  const rows = projects.map(({ projectId, projectName }) => {
    const name = stripVTControlCharacters(projectName).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    return [String(projectId), name]
  })
  for (const row of rows) table.push(row)
  const output = table.toString()
  if (columns && output.indexOf('\n') > columns) {
    return rows.map(row => row.join('  ')).join('\n')
  }
  return output
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(help)
    return
  }
  const [command, ...rest] = args
  if (command === 'hours') {
    const result = await hoursCommand(rest)
    if (!result.projects) return result
    const { json, ...output } = result
    if (json || !process.stdout.isTTY) return output
    process.stdout.write(formatProjects(result.projects, process.stdout.columns) + '\n')
    return
  }
  if (command === 'login') {
    let values: { timeout?: string; browser?: boolean }
    try {
      values = parseArgs({
        args: rest,
        options: { timeout: { type: 'string' }, browser: { type: 'boolean' } },
      }).values
    } catch {
      throw new CliError('INVALID_USAGE', '请使用 vela login [--timeout 秒] [--browser]。', 2)
    }
    const timeoutSeconds = Number(values.timeout ?? 180)
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 900) {
      throw new CliError('INVALID_USAGE', '--timeout 必须是 10 至 900 之间的整数秒。', 2)
    }
    const session = await browserLogin(timeoutSeconds, values.browser ?? false)
    const account = await accountFor(session)
    await withSessionLock(() => saveSession(session))
    return { ok: true, authenticated: true, account }
  }
  if (command === 'logout' && rest.length === 0) {
    return withSessionLock(async () => {
      const session = await loadSession().catch((error: unknown) => {
        if (error instanceof CliError && error.code === 'LOGIN_REQUIRED') return undefined
        throw error
      })
      if (session) {
        await logoutSession(session)
        await clearSession()
      }
      return { ok: true, authenticated: false }
    })
  }
  if (command === 'auth' && rest.length === 1 && rest[0] === 'status') {
    return withSessionLock(async () => {
      const session = await loadSession()
      const account = await accountFor(session).catch(async (error: unknown) => {
        if (!(error instanceof CliError) || error.code !== 'SESSION_EXPIRED') throw error
        const refreshed = await refreshSession(session)
        await saveSession(refreshed)
        return accountFor(refreshed)
      })
      return { ok: true, authenticated: true, account }
    })
  }
  throw new CliError('INVALID_USAGE', '未知命令，请运行 vela --help。', 2)
}

try {
  const result = await main()
  if (result) process.stdout.write(JSON.stringify(result) + '\n')
} catch (error) {
  const problem = error instanceof CliError
    ? error
    : new CliError('LOCAL_ERROR', '命令执行失败，请检查本地安装和会话目录。')
  process.stdout.write(JSON.stringify({
    ok: false,
    error: { code: problem.code, message: problem.message },
  }) + '\n')
  process.exitCode = problem.exitCode
}
