import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import stringWidth from 'string-width'

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
const preload = fileURLToPath(new URL('./task-api.mjs', import.meta.url))

function setup(t, accessToken) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-task-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sessionDir = join(dir, 'vela-cli')
  const session = join(sessionDir, 'session.json')
  const state = join(dir, 'task-app.json')
  mkdirSync(sessionDir, { mode: 0o700 })
  writeFileSync(state, 'null')
  if (accessToken) {
    writeFileSync(session, JSON.stringify({ accessToken, refreshToken: 'refresh' }), { mode: 0o600 })
  }
  const run = (args, mode = '') => spawnSync(process.execPath, ['--import', preload, cli, 'task', ...args], {
    env: { ...process.env, XDG_STATE_HOME: dir, VELA_TEST_MODE: mode, VELA_TEST_STATE: state },
    encoding: 'utf8',
    timeout: 10_000,
  })
  const posts = () => existsSync(state + '.posts')
    ? readFileSync(state + '.posts', 'utf8').trim().split('\n').map(JSON.parse) : []
  return { run, session, posts }
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
  assert.deepEqual(JSON.parse(readFileSync(session, 'utf8')), { accessToken: 'active', refreshToken: 'new-refresh' })
})

test('displays task help and validates IDs before loading a session', t => {
  const { run } = setup(t)
  const help = run([])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /vela task get/)
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
