import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const date = '2024-09-02'
const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
const preload = fileURLToPath(new URL('./hours-api.mjs', import.meta.url))
const existing = [
  { projectId: 10, projectName: '修改项目', filled: true, manualWorkHours: 2, todoWorkHours: 1.5, workHours: 3.5, progress: 40, content: '保留内容' },
  { projectId: 20, projectName: '保留项目', filled: true, workHours: 2, progress: 60, content: '原有内容' },
  { projectId: 40, projectName: '未填写项目', filled: false, workHours: 0.5, progress: 0, content: '' },
]
const entries = [
  { projectId: 30, hours: 1.5, progress: 0, content: ' 新记录 ' },
  { projectId: '10', hours: 3 },
]

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-hours-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const state = join(dir, 'cards.json')
  const sessionDir = join(dir, 'vela-cli')
  const session = join(sessionDir, 'session.json')
  mkdirSync(sessionDir, { mode: 0o700 })
  const setCards = cards => writeFileSync(state, JSON.stringify(cards))
  const setToken = accessToken => writeFileSync(session, JSON.stringify({ accessToken, refreshToken: 'old-refresh' }), { mode: 0o600 })
  setCards(existing)
  setToken('active')
  function runRaw(args, { input, mode, columns } = {}) {
    const p = spawnSync(process.execPath, ['--import', preload, cli, 'hours', ...args], {
      env: {
        ...process.env,
        XDG_STATE_HOME: dir,
        VELA_TEST_STATE: state,
        VELA_TEST_MODE: mode ?? '',
        VELA_TEST_COLUMNS: columns ?? '',
      },
      input: input === undefined ? undefined : JSON.stringify(input),
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert(p.stdout, p.stderr)
    return p
  }
  function run(args, input, mode) {
    const p = runRaw(args, { input, mode })
    return [p.status, JSON.parse(p.stdout)]
  }
  const submit = (input, apply, mode) => run(
    ['submit', '--date', date, '--file', '-', ...(apply ? ['--apply', apply] : [])], input, mode,
  )
  const posts = () => existsSync(state + '.posts')
    ? readFileSync(state + '.posts', 'utf8').trim().split('\n').map(JSON.parse) : []
  return { run, runRaw, submit, posts, setCards, setToken, session }
}

test('formats projects for a terminal and preserves the JSON output for scripts', t => {
  const { runRaw } = setup(t)
  const table = runRaw(['projects'], { columns: 80 })
  assert.equal(table.status, 0)
  assert.match(table.stdout, /│ 项目 ID +│ 项目名 +│/)
  assert.match(table.stdout, /│ 30 +│ 可新增项目 +│/)

  const narrow = runRaw(['projects'], { columns: 16 })
  assert.equal(narrow.status, 0)
  assert.equal(narrow.stdout, '30  可新增项目\n')

  const piped = runRaw(['projects'])
  const forced = runRaw(['projects', '--json'], { columns: 80 })
  assert.equal(piped.status, 0)
  assert.equal(forced.status, 0)
  assert.equal(piped.stdout, '{"ok":true,"projects":[{"projectId":30,"projectName":"可新增项目"}]}\n')
  assert.equal(forced.stdout, piped.stdout)
})

test('previews and applies a multi-project update without overwriting other fields', t => {
  const { run, submit, posts } = setup(t)
  const [dayExit, day] = run(['day', '--date', date])
  assert.equal(dayExit, 0)
  assert.equal(day.totalHours, 5.5)
  assert.equal(day.cards[2].hours, null)
  assert.deepEqual(run(['projects'])[1].projects, [{ projectId: 30, projectName: '可新增项目' }])
  const [previewExit, preview] = submit(entries)
  assert.equal(previewExit, 0)
  assert.equal(preview.submitted, false)
  assert.deepEqual(preview.changes.map(change => change.action), ['update', 'create'])
  assert.deepEqual(posts(), [])
  const [applyExit, result] = submit([...entries].reverse(), preview.previewId)
  assert.equal(applyExit, 0)
  assert.equal(result.submitted, true)
  assert.equal(result.totalHours, 8)
  assert.deepEqual(posts(), [{
    reportDate: date,
    items: [
      { projectId: 10, workHours: 3, progress: 40, content: '保留内容' },
      { projectId: 20, workHours: 2, progress: 60, content: '原有内容' },
      { projectId: 30, workHours: 1.5, progress: 0, content: '新记录' },
    ],
  }])
})

test('rejects stale previews, invalid input and incomplete existing cards without submitting', t => {
  const { submit, posts, setCards } = setup(t)
  const [, preview] = submit(entries)
  assert.equal(submit(entries, preview.previewId, 'different-user')[1].error.code, 'PREVIEW_STALE')
  setCards([existing[0], { ...existing[1], progress: 70 }])
  assert.equal(submit(entries, preview.previewId)[1].error.code, 'PREVIEW_STALE')
  for (const input of [
    [], [{ projectId: 30, hours: 1 }], [{ projectId: 10, hours: 1.2 }],
    [{ projectId: 99, hours: 2 }], [{ projectId: 10, progress: 1 }, { projectId: '10', progress: 2 }],
  ]) assert.equal(submit(input)[0], 2)
  setCards([existing[0], { ...existing[1], content: null }])
  assert.equal(submit(entries)[1].error.code, 'INCOMPLETE_REPORT')
  assert.deepEqual(posts(), [])
})

test('refreshes an expired session for read operations and saves the rotated tokens', t => {
  const { run, setToken, session } = setup(t)
  setToken('expired')
  assert.equal(run(['day', '--date', date])[0], 0)
  assert.equal(JSON.parse(readFileSync(session, 'utf8')).refreshToken, 'new-refresh')
})

for (const mode of ['lost-before-write', 'lost-after-write']) {
  test(`reconciles ${mode} by reading back without replaying the POST`, t => {
    const { submit, posts } = setup(t)
    const [, preview] = submit(entries)
    const [exit, result] = submit(entries, preview.previewId, mode)
    assert.equal(posts().length, 1)
    if (mode === 'lost-after-write') {
      assert.equal(exit, 0)
      assert.equal(result.submitted, true)
    } else {
      assert.equal(exit, 1)
      assert.equal(result.error.code, 'SUBMIT_UNCERTAIN')
    }
  })
}
