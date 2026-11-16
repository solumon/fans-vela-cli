import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const reply = data => Response.json({ code: 0, data })
const mode = process.env.VELA_TEST_MODE
const statePath = process.env.VELA_TEST_STATE
const statuses = [{ status: 0, name: '新建' }, { status: 1, name: '已解决' }]
const candidate = { id: 200, nickname: '测试处理人' }
const initial = { id: 73, title: '缺陷示例', status: 0, handlerUserId: 100, handlerNickname: '测试账号',
  severity: 3, description: '<p>第一行</p><p>第二行 &amp; 示例</p>', createTime: 1794552081000 }

if (mode === 'terminal') {
  process.stdout.isTTY = true
  process.stdout.columns = 80
}

globalThis.fetch = async (address, init) => {
  const url = new URL(address)
  assert.equal(url.origin, 'https://vela-api.up366demo.cn')
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer active')
  const path = url.pathname.replace('/admin-api/', '/')
  const query = url.searchParams
  const previous = JSON.parse(readFileSync(statePath, 'utf8'))
  const defect = previous.defect ?? { ...initial, ...(mode === 'changed-handler' ? { handlerUserId: 101 } : {}) }

  if (path === '/pmp/defect/change-status') {
    assert.equal(init.method, 'PUT')
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json')
    const body = JSON.parse(init.body)
    appendFileSync(statePath + '.writes', JSON.stringify(body) + '\n')
    if (mode === 'lost-before-write') throw new Error('request lost')
    const updated = { ...defect, status: Number(body.targetState) }
    if (body.handlerUserId !== undefined) Object.assign(updated, { handlerUserId: body.handlerUserId, handlerNickname: candidate.nickname })
    const log = { id: 2, event: body.event, creator: mode === 'unrelated-log' ? '999' : '100',
      fromState: String(defect.status), toState: body.targetState, handlerUserId: body.handlerUserId }
    writeFileSync(statePath, JSON.stringify({ defect: updated, log }))
    if (mode === 'lost-after-write') throw new Error('response lost')
    return reply(true)
  }

  assert.equal(init.method, 'GET')
  switch (path) {
    case '/system/auth/get-permission-info':
      return reply({ user: { id: mode === 'different-account' ? 201 : 100, nickname: '测试账号' } })
    case '/system/user/simple-list':
      return reply([candidate])
    case '/pmp/defect/status-list':
      return reply(statuses)
    case '/pmp/defect/page':
      assert.equal(query.get('handlerUserIds[0]'), '100')
      assert.equal(query.get('pageNo'), '2')
      assert.equal(query.get('pageSize'), '1')
      assert.equal(query.get('statusList[0]'), '0')
      return reply({ total: 2, list: [initial] })
    case '/pmp/defect/get':
      assert.equal(query.get('id'), '73')
      return reply(defect)
    case '/pmp/defect/action-list':
      assert.equal(query.get('id'), '73')
      return reply([
        { event: 'resolve', eventName: '解决', toState: '1', permitted: mode !== 'forbidden',
          handlerRequired: mode !== 'optional-handler', handlerCandidateUserIds: [200],
          missingRequiredFields: mode === 'missing-fields' ? [{ key: 'fixUserId', label: '修复人' }] : null },
        { event: 'handoff', toState: String(defect.status), permitted: true, handlerRequired: true, handlerCandidateUserIds: [] },
      ])
    case '/pmp/attachment/list':
      assert.equal(query.get('bizType'), 'pmp_defect')
      assert.equal(query.get('bizId'), '73')
      return reply([{ id: 77, name: '截图.png' }])
    case '/fsm/transition-log/page':
    case '/pmp/change-log/page': {
      assert.equal(query.get('bizType'), 'pmp_defect')
      assert.equal(query.get('bizId'), '73')
      const page = Number(query.get('pageNo'))
      const size = Number(query.get('pageSize'))
      const existing = path === '/pmp/change-log/page'
        ? Array.from({ length: 11 }, (_, index) => ({ id: 20 - index }))
        : [{ id: 1, event: 'handoff', creator: '100', fromState: '0', toState: '0', handlerUserId: 200 }]
      if (path === '/fsm/transition-log/page' && previous.log) existing.unshift(previous.log)
      const offset = (page - 1) * size
      return reply({ total: existing.length, list: existing.slice(offset, offset + size) })
    }
    default:
      assert.fail('Unexpected route ' + path)
  }
}
