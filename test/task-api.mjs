import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const reply = data => Response.json({ code: 0, data })
const mode = process.env.VELA_TEST_MODE
const state = process.env.VELA_TEST_STATE
const existing = { id: 9, appId: 10, appName: 'demo', submitGitBranch: 'dev', version: '1.0.0' }
const report = { id: 64, appName: 'report6-html' }

if (mode === 'terminal' || mode === 'narrow') {
  process.stdout.isTTY = true
  process.stdout.columns = mode === 'narrow' ? 24 : 80
}

globalThis.fetch = async (address, init) => {
  const url = new URL(address)
  assert.equal(url.origin, 'https://vela-api.up366demo.cn')
  const route = url.pathname.replace('/admin-api/pmp/', '')
  if (url.pathname === '/admin-api/system/auth/refresh-token') {
    assert.equal(init.method, 'POST')
    assert.equal(url.searchParams.get('refreshToken'), 'refresh')
    return reply({ accessToken: 'active', refreshToken: 'new-refresh' })
  }
  const token = new Headers(init.headers).get('Authorization')
  if (token === 'Bearer expired') return Response.json({ code: 401 })
  assert.equal(token, 'Bearer active')
  if (url.pathname === '/admin-api/system/auth/get-permission-info') {
    assert.equal(init.method, 'GET')
    return reply({ user: { id: mode === 'different-user' ? 2 : 1, nickname: '测试账号' } })
  }
  if (route === 'dev-task-app/create') {
    assert.equal(init.method, 'POST')
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json')
    const payload = JSON.parse(init.body)
    appendFileSync(state + '.posts', JSON.stringify(payload) + '\n')
    if (mode === 'lost-before-write') throw new Error('connection reset')
    writeFileSync(state, JSON.stringify({ id: 11, appName: report.appName, ...payload }))
    if (mode === 'lost-after-write') throw new Error('response lost')
    return reply(11)
  }
  assert.equal(init.method, 'GET')
  switch (route) {
    case 'application/app/get':
      assert.equal(url.searchParams.get('id'), '64')
      return reply(report)
    case 'application/app/page': {
      const name = url.searchParams.get('appName')
      const pageNo = Number(url.searchParams.get('pageNo'))
      const pageSize = Number(url.searchParams.get('pageSize'))
      const matches = name === 'demo' ? [{ id: existing.appId, appName: existing.appName }]
        : report.appName.includes(name) ? [report] : []
      if (mode === 'ambiguous') {
        const related = Array.from({ length: pageSize - 1 }, (_, index) => ({
          id: 100 + index, appName: report.appName + '-' + index,
        }))
        matches.push(...related, { id: 65, appName: report.appName })
      }
      const start = (pageNo - 1) * pageSize
      return reply({ total: matches.length, list: matches.slice(start, start + pageSize) })
    }
    case 'dev-task/get':
      assert.equal(url.searchParams.get('id'), '26')
      return reply({ id: 26, taskName: '测试任务', status: 1, devStartTime: 1793721600000 })
    case 'dev-task-app/list': {
      assert.equal(url.searchParams.get('devTaskId'), '26')
      const added = JSON.parse(readFileSync(state, 'utf8'))
      return reply(added ? [existing, added] : [existing])
    }
    case 'dev-task-member/list':
      assert.equal(url.searchParams.get('devTaskId'), '26')
      return reply([{ nickname: '测试成员' }])
    case 'task/list':
      assert.equal(url.searchParams.get('businessType'), 'pmp_dev_task')
      assert.equal(url.searchParams.get('businessId'), '26')
      return reply([])
    case 'attachment/list':
    case 'change-log/page': {
      assert.equal(url.searchParams.get('bizType'), 'pmp_dev_task')
      assert.equal(url.searchParams.get('bizId'), '26')
      if (route === 'attachment/list') return reply([])
      const pageNo = Number(url.searchParams.get('pageNo'))
      const pageSize = Number(url.searchParams.get('pageSize'))
      const total = 2 * pageSize + 1
      const offset = (pageNo - 1) * pageSize
      const count = mode === 'short-page' && pageNo === 2 ? 0 : Math.min(pageSize, total - offset)
      return reply({ total, list: Array.from({ length: count }, (_, index) => ({ id: offset + index + 1 })) })
    }
    default:
      assert.fail('Unexpected route ' + route)
  }
}
