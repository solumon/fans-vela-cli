import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const file = process.env.VELA_TEST_STATE
const mode = process.env.VELA_TEST_MODE
const reply = data => Response.json({ code: 0, data })

globalThis.fetch = async (address, init) => {
  const url = new URL(address)
  assert.equal(url.origin, 'https://vela-api.up366demo.cn')
  assert.equal(init.redirect, 'error')
  const route = url.pathname.replace('/admin-api', '')
  const token = new Headers(init.headers).get('Authorization')
  if (route === '/system/auth/refresh-token') {
    assert.equal(init.method, 'POST')
    assert.equal(url.searchParams.get('refreshToken'), 'old-refresh')
    return reply({ accessToken: 'active', refreshToken: 'new-refresh' })
  }
  if (token === 'Bearer expired') return Response.json({ code: 401 })
  assert.equal(token, 'Bearer active')
  if (route === '/system/auth/get-permission-info') {
    return reply({ user: { id: mode === 'different-user' ? 2 : 1, nickname: '测试账号' } })
  }
  if (route.endsWith('/my-card-list')) {
    assert.equal(init.method, 'GET')
    assert.equal(url.searchParams.get('date'), '2024-09-02')
    return reply(JSON.parse(readFileSync(file, 'utf8')))
  }
  if (route.endsWith('/reportable-project-list')) {
    return reply([{ projectId: 30, projectName: '可新增项目' }])
  }
  assert.equal(route, '/pmp/daily-report/submit')
  assert.equal(init.method, 'POST')
  assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json')
  const body = JSON.parse(init.body)
  appendFileSync(file + '.posts', JSON.stringify(body) + '\n')
  if (mode === 'lost-before-write') throw new Error('connection reset')
  const previous = JSON.parse(readFileSync(file, 'utf8'))
  const cards = body.items.map(item => {
    const existing = previous.find(card => card.projectId === item.projectId)
    const todoWorkHours = existing?.todoWorkHours ?? 0
    return {
      ...item,
      projectName: existing?.projectName ?? '可新增项目',
      filled: true,
      manualWorkHours: item.workHours,
      todoWorkHours,
      workHours: item.workHours + todoWorkHours,
    }
  })
  writeFileSync(file, JSON.stringify(cards))
  if (mode === 'lost-after-write') throw new Error('response lost')
  return reply(true)
}
