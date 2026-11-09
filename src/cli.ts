#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { browserLogin } from './browser-login.js'
import { hoursCommand } from './hours.js'
import { clearSession, loadSession, saveSession, withSessionLock } from './session.js'
import { formatAccount, formatError, formatHelp, formatHours, TerminalUi } from './terminal-ui.js'
import { accountFor, CliError, logoutSession, refreshSession } from './vela.js'

async function main(args: string[], terminal: TerminalUi) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(formatHelp(terminal.interactive) + '\n')
    return
  }
  const [command, ...rest] = args
  if (command === 'hours') {
    const subcommand = rest[0]
    if (subcommand === 'day') terminal.wait('正在查询工作日报')
    if (subcommand === 'projects') terminal.wait('正在查询可填报项目')
    if (subcommand === 'submit') terminal.wait('正在处理日报填报')
    return hoursCommand(rest)
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
    terminal.wait('正在打开 VELA 登录页')
    const session = await browserLogin(timeoutSeconds, values.browser ?? false, terminal)
    terminal.wait('正在核验账号')
    const account = await accountFor(session)
    await withSessionLock(() => saveSession(session))
    return { ok: true, authenticated: true, account }
  }
  if (command === 'logout' && rest.length === 0) {
    terminal.wait('正在退出登录')
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
    terminal.wait('正在查询登录状态')
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

const args = process.argv.slice(2)
const optionEnd = args.indexOf('--')
const commandArgs = args.filter((arg, index) => arg !== '--json' || (optionEnd !== -1 && index > optionEnd))
const terminal = new TerminalUi(args.length === commandArgs.length && Boolean(process.stdout.isTTY))

try {
  const result = await main(commandArgs, terminal)
  terminal.stop()
  if (result) {
    let output: string
    if (!terminal.interactive) {
      output = JSON.stringify(result)
    } else if ('authenticated' in result) {
      output = formatAccount('account' in result ? result.account.nickname : undefined, commandArgs[0] === 'login')
    } else {
      output = formatHours(result, process.stdout.columns)
    }
    process.stdout.write(output + '\n')
  }
} catch (error) {
  terminal.stop()
  const problem = error instanceof CliError
    ? error
    : new CliError('LOCAL_ERROR', '命令执行失败，请检查本地安装和会话目录。')
  if (terminal.interactive) {
    process.stderr.write(formatError(problem) + '\n')
  } else {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { code: problem.code, message: problem.message },
    }) + '\n')
  }
  process.exitCode = problem.exitCode
}
