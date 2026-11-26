import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import stringWidth from 'string-width'
import { isWindows, sessionFixture } from './session-fixture.mjs'

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
const preload = new URL('./task-api.mjs', import.meta.url).href

function setup(t, accessToken) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-task-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const session = sessionFixture(dir)
  const state = join(dir, 'task-app.json')
  writeFileSync(state, 'null')
  if (accessToken) session.write({ accessToken, refreshToken: 'refresh' })
  const run = (args, mode = '') => spawnSync(process.execPath, ['--import', preload, cli, 'task', ...args], {
    env: { ...process.env, XDG_STATE_HOME: dir, VELA_TEST_MODE: mode, VELA_TEST_STATE: state },
    encoding: 'utf8',
    timeout: 10_000,
  })
  const writes = (suffix) => existsSync(state + suffix)
    ? readFileSync(state + suffix, 'utf8').trim().split('\n').map(JSON.parse) : []
  return { run, session, posts: () => writes('.posts'), puts: () => writes('.puts') }
}

test('reads all task history pages and saves the refreshed session', t => {
  const { run, session } = setup(t, 'expired')
  const result = run(['get', '26', '--json'])
  assert.equal(result.status, 0, result.stdout || result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.task.id, 26)
  assert.equal(data.applications[0].appName, 'demo')
  assert.equal(data.members[0].nickname, '测试成员')
  assert.deepEqual(data.plan, [])
  assert.deepEqual(data.attachments, [])
  assert.deepEqual(data.history.map(item => item.id), Array.from({ length: 21 }, (_, index) => index + 1))
  assert.deepEqual(session.read(), { accessToken: 'active', refreshToken: 'new-refresh' })
})

for (const useXdg of [false, true]) {
  const location = useXdg ? '$XDG_STATE_HOME' : '~'
  test(`migrates and refreshes the old session in ${location}/.vela/auth.json`, { skip: isWindows }, t => {
    const home = mkdtempSync(join(tmpdir(), 'vela-auth-'))
    t.after(() => rm(home, { recursive: true, force: true }))
    const xdg = useXdg ? join(home, 'xdg') : ''
    const legacyDir = join(xdg || join(home, '.local', 'state'), 'vela-cli')
    const legacySession = join(legacyDir, 'session.json')
    mkdirSync(legacyDir, { recursive: true, mode: 0o700 })
    writeFileSync(legacySession, '{"accessToken":"expired","refreshToken":"refresh"}', { mode: 0o600 })

    const result = spawnSync(process.execPath, ['--import', preload, cli, 'auth', 'status', '--json'], {
      env: { ...process.env, HOME: home, XDG_STATE_HOME: xdg },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 0, result.stdout || result.stderr)
    assert.equal(JSON.parse(result.stdout).authenticated, true)
    assert.equal(existsSync(legacySession), false)
    const authDir = join(xdg || home, '.vela')
    const auth = join(authDir, 'auth.json')
    assert.deepEqual(JSON.parse(readFileSync(auth, 'utf8')), { accessToken: 'active', refreshToken: 'new-refresh' })
    assert.equal(statSync(authDir).mode & 0o777, 0o700)
    assert.equal(statSync(auth).mode & 0o777, 0o600)
  })
}

test('displays task help and validates IDs before loading a session', t => {
  const { run } = setup(t)
  const help = run([])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /vela task get/)
  assert.match(help.stdout, /vela task app update .+\n +--content <正文>/)
  const invalid = run(['get', '1.5'])
  assert.equal(invalid.status, 2)
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_USAGE')
})

test('shows task and application tables and keeps JSON available', t => {
  const { run } = setup(t, 'active')
  const terminal = run(['get', '26'], 'terminal')
  assert.equal(terminal.status, 0)
  const output = stripVTControlCharacters(terminal.stdout)
  assert.match(output, /│ 任务编号 +│ 26 +│/)
  assert.match(output, /│ 任务标题 +│ 测试任务 +│/)
  assert.match(output, /│ 状态 +│ 开发中 +│/)
  assert.match(output, /│ 开发启动 +│ 2026-11-04 +│/)
  assert.match(output, /│ 变更历史 +│ 21 条 +│/)
  assert.match(output, /│ 应用名称 +│ 提测 Git 分支 +│ 版本号 +│/)
  assert.match(output, /│ demo +│ dev +│ 1\.0\.0 +│/)
  assert.ok(output.split('\n').every(line => stringWidth(line) <= 80))

  const narrow = run(['get', '26'], 'narrow')
  assert.equal(narrow.status, 0)
  const compact = stripVTControlCharacters(narrow.stdout)
  assert.match(compact, /│ 任务信息 +│/)
  assert.match(compact, /│ 提测分支 dev +│/)
  assert.ok(compact.split('\n').every(line => stringWidth(line) <= 24))

  const json = run(['get', '26', '--json'], 'terminal')
  assert.equal(json.status, 0)
  assert.equal(json.stdout, run(['get', '26']).stdout)
})

test('rejects incomplete history', t => {
  const { run } = setup(t, 'active')
  const incomplete = run(['get', '26'], 'short-page')
  assert.equal(incomplete.status, 1)
  assert.equal(JSON.parse(incomplete.stdout).error.code, 'API_ERROR')
})

test('previews an app association and submits only matching parameters under the same account', t => {
  const { run, posts } = setup(t, 'active')
  const args = ['app', 'add', '26', '--app', 'report6-html', '--version', '2.4.9']
  const terminal = run(args, 'terminal')
  assert.equal(terminal.status, 0)
  assert.match(stripVTControlCharacters(terminal.stdout), /│ 应用 +│ #64  report6-html +│/)
  const preview = run([...args, '--json'], 'terminal')
  assert.equal(preview.status, 0)
  const { submitted, previewId, taskApp } = JSON.parse(preview.stdout)
  assert.equal(submitted, false)
  assert.equal(taskApp.submitGitBranch, 'dev')
  assert.match(terminal.stdout, new RegExp(previewId))

  const changed = run([...args, '--branch', 'main', '--apply', previewId])
  assert.equal(JSON.parse(changed.stdout).error.code, 'PREVIEW_STALE')
  const confirmed = [...args, '--apply', previewId]
  const otherAccount = run(confirmed, 'different-user')
  assert.equal(JSON.parse(otherAccount.stdout).error.code, 'PREVIEW_STALE')
  assert.deepEqual(posts(), [])

  const applied = run(confirmed)
  assert.equal(applied.status, 0, applied.stdout)
  assert.equal(JSON.parse(applied.stdout).association.id, 11)
  const repeated = run(confirmed)
  assert.equal(JSON.parse(repeated.stdout).error.code, 'APP_ALREADY_LINKED')
  assert.deepEqual(posts(), [{ devTaskId: 26, appId: 64, submitGitBranch: 'dev', version: '2.4.9' }])
})

test('requires an exact unambiguous catalog name or an explicit app ID', t => {
  const { run, posts } = setup(t, 'active')
  const args = ['app', 'add', '26']
  const partial = run([...args, '--app', 'report6'])
  assert.equal(JSON.parse(partial.stdout).error.code, 'APP_NOT_FOUND')
  assert.match(partial.stdout, /report6-html \(#64\)/)
  const ambiguous = run([...args, '--app', 'report6-html'], 'ambiguous')
  assert.equal(JSON.parse(ambiguous.stdout).error.code, 'APP_AMBIGUOUS')
  assert.match(ambiguous.stdout, /report6-html \(#65\)/)
  const linked = run([...args, '--app', 'demo', '--branch', 'another'])
  assert.equal(JSON.parse(linked.stdout).error.code, 'APP_ALREADY_LINKED')
  const byId = run([...args, '--app-id', '64', '--branch', 'feature/reports'])
  assert.equal(byId.status, 0)
  assert.equal(JSON.parse(byId.stdout).taskApp.submitGitBranch, 'feature/reports')
  assert.deepEqual(posts(), [])
})

for (const mode of ['lost-after-write', 'lost-before-write']) {
  test(`reconciles ${mode} without replaying the create request`, t => {
    const { run, posts } = setup(t, 'active')
    const args = ['app', 'add', '26', '--app-id', '64']
    const { previewId } = JSON.parse(run(args).stdout)
    const applied = run([...args, '--apply', previewId], mode)
    const data = JSON.parse(applied.stdout)
    if (mode === 'lost-after-write') {
      assert.equal(applied.status, 0)
      assert.equal(data.submitted, true)
    } else {
      assert.equal(applied.status, 1)
      assert.equal(data.error.code, 'SUBMIT_UNCERTAIN')
    }
    assert.deepEqual(posts(), [{ devTaskId: 26, appId: 64, submitGitBranch: 'dev' }])
  })
}

test('previews and updates multiline app content against the latest association', t => {
  const { run, puts } = setup(t, 'active')
  const content = '影响模块：报告页\n测试要点：比较 A < B'
  const args = ['app', 'update', '26', '--app', 'demo', '--content', content]
  const preview = JSON.parse(run(args).stdout)
  assert.equal(preview.submitted, false)
  assert.deepEqual(preview.appUpdate, {
    devTaskId: 26, taskName: '测试任务', appId: 10, appName: 'demo', associationId: 9, before: '', after: content,
  })
  const terminal = stripVTControlCharacters(run(args, 'terminal').stdout)
  assert.match(terminal, /新内容 +│ 影响模块：报告页/)
  assert.match(terminal, /测试要点：比较 A < B/)
  assert.match(terminal, new RegExp(preview.previewId))
  assert.deepEqual(puts(), [])

  const applied = run([...args, '--apply', preview.previewId], 'changed-branch')
  assert.equal(applied.status, 0, applied.stdout)
  const result = JSON.parse(applied.stdout)
  assert.equal(result.submitted, true)
  assert.equal(result.association.updateContent, content)
  assert.deepEqual(puts(), [{
    id: 9, devTaskId: 26, appId: 10, appName: 'demo', submitGitBranch: 'release',
    version: '1.0.0', updateContent: content, dbChanged: true,
  }])
  const details = run(['get', '26'])
  assert.equal(JSON.parse(details.stdout).applications[0].updateContent, content)
  assert.match(run(['get', '26'], 'terminal').stdout, /测试要点：比较 A < B/)

  const clear = ['app', 'update', '26', '--app-id', '10', '--content', '']
  const clearPreview = JSON.parse(run(clear).stdout)
  assert.equal(clearPreview.appUpdate.before, content)
  const cleared = JSON.parse(run([...clear, '--apply', clearPreview.previewId]).stdout)
  assert.equal(cleared.submitted, true)
  assert.equal(cleared.association.updateContent, '')
})

test('rejects stale app content previews and ambiguous or invalid input without writing', t => {
  const { run, puts } = setup(t, 'active')
  const args = ['app', 'update', '26', '--app', 'demo', '--content', '新正文']
  const { previewId } = JSON.parse(run(args).stdout)
  const confirmed = [...args, '--apply', previewId]
  for (const mode of ['changed-content', 'different-user', 'ambiguous-links']) {
    assert.equal(JSON.parse(run(confirmed, mode).stdout).error.code, 'PREVIEW_STALE')
  }
  const ambiguous = JSON.parse(run(args, 'ambiguous-links').stdout)
  assert.equal(ambiguous.error.code, 'APP_AMBIGUOUS')
  assert.match(ambiguous.error.message, /--app-id/)
  assert.equal(JSON.parse(run(['app', 'update', '26', '--app', 'report6', '--content', '新正文']).stdout).error.code, 'APP_NOT_FOUND')
  assert.equal(JSON.parse(run(['app', 'update', '26', '--app', 'demo', '--file', 'update.txt']).stdout).error.code, 'INVALID_USAGE')
  assert.deepEqual(puts(), [])
})

for (const mode of ['lost-after-write', 'lost-before-write']) {
  test(`checks app content after ${mode} without replaying the update`, t => {
    const { run, puts } = setup(t, 'active')
    const args = ['app', 'update', '26', '--app-id', '10', '--content', '新正文']
    const { previewId } = JSON.parse(run(args).stdout)
    const applied = run([...args, '--apply', previewId], mode)
    const data = JSON.parse(applied.stdout)
    if (mode === 'lost-after-write') {
      assert.equal(applied.status, 0)
      assert.equal(data.submitted, true)
    } else {
      assert.equal(applied.status, 1)
      assert.equal(data.error.code, 'SUBMIT_UNCERTAIN')
    }
    assert.equal(puts().length, 1)
  })
}
