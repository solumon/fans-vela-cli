import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const session = { accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }
const refreshed = { accessToken: 'rotated-access-token', refreshToken: 'rotated-refresh-token' }
const reply = data => Response.json({ code: 0, data })

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'playwright') return { url: import.meta.url, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

export const chromium = {
  async launch(options) {
    assert.deepEqual(options, { channel: 'chrome', headless: false })
    return {
      async newPage() {
        return {
          async goto() {},
          waitForResponse: async () => ({ status: () => 200, json: async () => ({ code: 0, data: session }) }),
          getByRole: () => ({ async click() {} }),
          locator: () => ({ async waitFor() {} }),
        }
      },
      async close() {},
    }
  },
}
export const errors = { TimeoutError: class extends Error {} }

globalThis.fetch = async (address, init) => {
  const url = new URL(address)
  const token = new Headers(init.headers).get('Authorization')
  switch (url.pathname) {
    case '/admin-api/system/auth/get-permission-info':
      if (process.env.VELA_TEST_EXPIRED && token === `Bearer ${session.accessToken}`) {
        return Response.json({ code: 401 })
      }
      assert.equal(token, `Bearer ${process.env.VELA_TEST_EXPIRED ? refreshed.accessToken : session.accessToken}`)
      return reply({ user: { id: 1, nickname: '测试账号' } })
    case '/admin-api/system/auth/refresh-token':
      assert.equal(url.searchParams.get('refreshToken'), session.refreshToken)
      return reply(refreshed)
    case '/admin-api/system/auth/logout':
      assert.equal(token, `Bearer ${refreshed.accessToken}`)
      return reply(true)
    default:
      assert.fail('Unexpected route ' + url.pathname)
  }
}
