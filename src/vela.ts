export const loginPage = 'https://vela.up366demo.cn/login?redirect=/index'
const apiBase = 'https://vela-api.up366demo.cn/admin-api'
export const wecomLoginUrl = apiBase + '/system/auth/wecom/login'

export class CliError extends Error {
  constructor(public readonly code: string, message: string, public readonly exitCode = 1) {
    super(message)
  }
}

export interface Session {
  accessToken: string
  refreshToken: string
}

export interface Account {
  nickname: string
}

export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[!-~]+$/.test(value)
}

export function parseSession(value: unknown): Session | undefined {
  const { accessToken, refreshToken } = asObject(value)
  if (isToken(accessToken) && isToken(refreshToken)) {
    return { accessToken, refreshToken }
  }
}

type ApiOperation = 'status' | 'refresh' | 'logout' | 'report-submit'

export function unwrap(payload: unknown, status: number, operation: 'login' | ApiOperation) {
  const { code, data } = asObject(payload)
  const result = typeof code === 'number' || (typeof code === 'string' && /^-?\d+$/.test(code))
    ? Number(code)
    : NaN
  const succeeded = result === 0 || result === 200
  if ((operation === 'status' || operation === 'report-submit') && (status === 401 || result === 401)) {
    throw new CliError('SESSION_EXPIRED', '登录会话已过期，请重新运行 vela login。')
  }
  if (operation === 'refresh' && [status, result].some(code => code === 400 || code === 401)) {
    throw new CliError('SESSION_EXPIRED', '登录会话已过期，请重新运行 vela login。')
  }
  if (operation === 'login' && status < 500 && Number.isSafeInteger(result) && !succeeded) {
    throw new CliError('SCAN_REJECTED', `VELA 拒绝了本次登录（服务端代码 ${result}）。`)
  }
  if (operation === 'report-submit' && (status >= 500 || !Number.isSafeInteger(result))) {
    throw new CliError('SUBMIT_UNCERTAIN', 'VELA 未返回明确的提交结果。')
  }
  if (status < 200 || status >= 300 || !succeeded) {
    throw new CliError('API_ERROR', 'VELA 返回了异常响应，请稍后重试。')
  }
  return data
}

async function request(
  path: string,
  operation: ApiOperation,
  init: RequestInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(apiBase + path, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new CliError('NETWORK_ERROR', '无法连接 VELA API，请检查网络后重试。')
  }
  const payload: unknown = await response.json().catch(() => undefined)
  return unwrap(payload, response.status, operation)
}

export function requestWithSession(session: Session, path: string, body?: object) {
  return request(path, body === undefined ? 'status' : 'report-submit', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + session.accessToken,
      'Cache-Control': 'no-cache',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function identityFor(session: Session): Promise<Account & { id: string }> {
  const data = asObject(await requestWithSession(session, '/system/auth/get-permission-info'))
  const user = asObject(data.user)
  if (typeof user.nickname !== 'string' || !(Number(user.id) > 0)) {
    throw new CliError('API_ERROR', 'VELA 未返回有效的当前账号信息。')
  }
  return { nickname: user.nickname, id: String(user.id) }
}

export async function accountFor(session: Session): Promise<Account> {
  const { nickname } = await identityFor(session)
  return { nickname }
}

export async function logoutSession(session: Session): Promise<void> {
  const result = await request('/system/auth/logout', 'logout', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + session.accessToken,
    },
  })
  if (result !== true) {
    throw new CliError('API_ERROR', 'VELA 未确认退出登录，请稍后重试。')
  }
}

export async function refreshSession(session: Session): Promise<Session> {
  const query = new URLSearchParams({ refreshToken: session.refreshToken })
  const refreshed = parseSession(await request('/system/auth/refresh-token?' + query, 'refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  }))
  if (!refreshed) throw new CliError('API_ERROR', 'VELA 未返回完整的新会话。')
  return refreshed
}
