import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isWindows, sessionFixture } from './session-fixture.mjs'

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
const preload = new URL('./auth-api.mjs', import.meta.url).href

test('saves a browser login, rotates the stored session, and clears it on logout', t => {
  const home = mkdtempSync(join(tmpdir(), 'vela 登录 '))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const session = sessionFixture(home)
  const stateEnv = isWindows ? { LOCALAPPDATA: home, XDG_STATE_HOME: '' } : { XDG_STATE_HOME: home }
  function run(args, expired = '') {
    const result = spawnSync(process.execPath, ['--import', preload, cli, ...args, '--json'], {
      env: { ...process.env, ...stateEnv, VELA_TEST_EXPIRED: expired },
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.ifError(result.error)
    assert.ok(result.stdout, result.stderr)
    return JSON.parse(result.stdout)
  }

  assert.equal(run(['auth', 'status']).error?.code, 'LOGIN_REQUIRED')
  assert.deepEqual(run(['login', '--browser']), { ok: true, authenticated: true, account: { nickname: '测试账号' } })
  assert.deepEqual(session.read(), { accessToken: 'test-access-token', refreshToken: 'test-refresh-token' })
  assert.equal(run(['auth', 'status'], '1').authenticated, true)
  assert.deepEqual(session.read(), { accessToken: 'rotated-access-token', refreshToken: 'rotated-refresh-token' })
  if (isWindows) assert.equal(readFileSync(session.path).includes('rotated-refresh-token'), false)

  assert.deepEqual(run(['logout']), { ok: true, authenticated: false })
  assert.equal(existsSync(session.path), false)
  assert.equal(run(['auth', 'status']).error?.code, 'LOGIN_REQUIRED')
})
