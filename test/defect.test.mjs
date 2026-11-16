import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
const preload = fileURLToPath(new URL('./defect-api.mjs', import.meta.url))

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-defect-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sessionDir = join(dir, '.vela')
  const state = join(dir, 'defect.json')
  mkdirSync(sessionDir, { mode: 0o700 })
  writeFileSync(join(sessionDir, 'auth.json'), '{"accessToken":"active","refreshToken":"refresh"}', { mode: 0o600 })
  writeFileSync(state, '{}')
  const run = (args, mode = '') => spawnSync(process.execPath, ['--import', preload, cli, 'defect', ...args], {
    env: { ...process.env, XDG_STATE_HOME: dir, VELA_TEST_MODE: mode, VELA_TEST_STATE: state },
    encoding: 'utf8',
    timeout: 10_000,
  })
  const result = (args, mode) => {
    const output = run([...args, '--json'], mode)
    assert.ok(output.stdout, output.stderr)
    return JSON.parse(output.stdout)
  }
  const writes = () => existsSync(state + '.writes')
    ? readFileSync(state + '.writes', 'utf8').trim().split('\n').map(JSON.parse) : []
  return { run, result, writes }
}

test('queries the signed-in assignee with server filters and reads both detail histories', t => {
  const { run, result, writes } = setup(t)
  const list = result(['list', '--status', '新建', '--page', '2', '--page-size', '1'])
  assert.equal(list.total, 2)
  assert.equal(list.defects[0].statusName, '新建')
  const details = result(['get', '73', '--history'])
  assert.equal(details.defect.title, '缺陷示例')
  assert.equal(details.attachments[0].id, 77)
  assert.equal(details.actions[0].targetStatusName, '已解决')
  assert.equal(details.transitionHistory[0].event, 'handoff')
  assert.equal(details.changeHistory.at(-1).id, 10)
  assert.equal(result(['get', '73']).changeHistory, undefined)
  assert.deepEqual(writes(), [])
  assert.match(run(['get', '73'], 'terminal').stdout, /第二行 & 示例/)
})

test('validates permissions, required fields and candidate assignees without writing', t => {
  const { result, writes } = setup(t)
  const args = ['transition', '73', '--status', '已解决']
  const missing = result([...args, '--to', '200'], 'missing-fields')
  assert.equal(missing.error.code, 'DEFECT_FIELDS_REQUIRED')
  assert.match(missing.error.message, /修复人/)
  assert.equal(result([...args, '--to', '200'], 'forbidden').error.code, 'DEFECT_TRANSITION_NOT_ALLOWED')
  assert.equal(result([...args, '--to', '201']).error.code, 'DEFECT_HANDLER_NOT_ALLOWED')
  assert.equal(result(args).error.code, 'INVALID_USAGE')
  assert.deepEqual(writes(), [])
})

test('previews and confirms one status transition using the real request shape', t => {
  const { result, writes } = setup(t)
  const args = ['transition', '73', '--status', '已解决', '--to', '200', '--message', '修复 <标签> & 验证\n请复测']
  const preview = result(args)
  assert.equal(preview.submitted, false)
  assert.equal(preview.transition.before.handlerId, 100)
  assert.equal(preview.transition.after.handlerName, '测试处理人')
  const apply = [...args, '--apply', preview.previewId]
  assert.equal(result(apply, 'changed-handler').error.code, 'PREVIEW_STALE')
  assert.equal(result(apply, 'different-account').error.code, 'PREVIEW_STALE')
  assert.deepEqual(writes(), [])
  const applied = result(apply)
  assert.equal(applied.submitted, true)
  assert.equal(applied.defect.status, 1)
  assert.equal(applied.log.id, 2)
  assert.equal(result(apply).error.code, 'PREVIEW_STALE')
  assert.deepEqual(writes(), [{
    id: 73, event: 'resolve', targetState: '1', handlerUserId: 200,
    remarkHtml: '<p>修复 &lt;标签&gt; &amp; 验证</p><p>请复测</p>',
  }])
})

test('supports transitions with a server-selected handler', t => {
  const { result, writes } = setup(t)
  const args = ['transition', '73', '--status', '1']
  const preview = result(args, 'optional-handler')
  assert.equal(preview.transition.after.handlerId, undefined)
  const applied = result([...args, '--apply', preview.previewId], 'optional-handler')
  assert.equal(applied.submitted, true)
  assert.deepEqual(writes(), [{ id: 73, event: 'resolve', targetState: '1' }])
})

for (const mode of ['lost-before-write', 'lost-after-write', 'unrelated-log']) {
  test(`reconciles a handoff without resubmitting (${mode})`, t => {
    const { result, writes } = setup(t)
    const args = ['transition', '73', '--to', '200']
    const { previewId } = result(args)
    const applied = result([...args, '--apply', previewId], mode)
    if (mode === 'lost-after-write') assert.equal(applied.submitted, true)
    else assert.equal(applied.error.code, 'SUBMIT_UNCERTAIN')
    assert.deepEqual(writes(), [{ id: 73, event: 'handoff', targetState: '0', handlerUserId: 200 }])
  })
}
