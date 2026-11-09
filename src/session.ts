import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { asObject, CliError, parseSession, type Session } from './vela.js'

const stateDir = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'vela-cli')
const sessionPath = join(stateDir, 'session.json')

export async function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  await mkdir(stateDir, { mode: 0o700, recursive: true })
  const info = await lstat(stateDir)
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new CliError('LOCAL_STATE_ERROR', 'VELA CLI 的会话目录必须是仅当前用户可访问的本地目录。')
  }
  const release = await lockfile.lock(stateDir, {
    retries: { retries: 5, minTimeout: 250, maxTimeout: 1_000 },
    stale: 60_000,
    onCompromised: () => {
      // Stop before any other process can be left with stale refresh credentials.
      process.stdout.write(JSON.stringify({
        ok: false, error: { code: 'LOCAL_STATE_ERROR', message: '本地会话锁已失效，请重试。' },
      }) + '\n')
      process.exit(1)
    },
  }).catch(() => {
    throw new CliError('LOCAL_STATE_ERROR', 'VELA CLI 的本地会话暂时不可用，请稍后重试。')
  })
  try {
    return await action()
  } finally {
    await release()
  }
}

export async function loadSession(): Promise<Session> {
  try {
    const info = await lstat(sessionPath)
    if (!info.isFile() || (info.mode & 0o077) !== 0) {
      throw new CliError('LOCAL_STATE_ERROR', 'VELA CLI 的会话文件权限异常，请重新运行 vela login。')
    }
    const raw: unknown = JSON.parse(await readFile(sessionPath, 'utf8'))
    const session = parseSession(raw)
    if (session) return session
  } catch (error) {
    if (asObject(error).code === 'ENOENT') {
      throw new CliError('LOGIN_REQUIRED', '请先运行 vela login 完成企微扫码。')
    }
    if (error instanceof CliError) throw error
  }
  throw new CliError('LOCAL_STATE_ERROR', '无法读取 VELA CLI 的本地会话，请重新运行 vela login。')
}

export async function clearSession() {
  await rm(sessionPath, { force: true }).catch(() => {
    throw new CliError('LOCAL_STATE_ERROR', 'VELA 已退出登录，但无法清除本地会话，请检查会话目录后重试。')
  })
}

export async function saveSession(session: Session) {
  const temp = join(stateDir, 'session-' + randomUUID() + '.tmp')
  try {
    await writeFile(temp, JSON.stringify(session), { mode: 0o600, flag: 'wx' })
    await rename(temp, sessionPath)
  } finally {
    await rm(temp, { force: true })
  }
}
