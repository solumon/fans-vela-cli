import { CliError, loginPage, parseSession, unwrap, wecomLoginUrl, type Session } from './vela.js'
import type { Page } from 'playwright'

const wecomFrame = '#pane-wecom iframe[src^="https://login.work.weixin.qq.com/"]'
const wecomQrEndpoint = 'https://login.work.weixin.qq.com/wwlogin/sso/qrcode'

async function showQr(page: Page, showBrowser: boolean) {
  const openWecomTab = () =>
    page.getByRole('tab', { name: '企微扫码登录', exact: true }).click({ timeout: 15_000 })
  let image: Buffer | undefined
  try {
    if (showBrowser) {
      await openWecomTab()
      await page.locator(wecomFrame).waitFor({ state: 'visible', timeout: 20_000 })
    } else {
      // Use the original PNG before Chrome scales it to fit the sign-in panel.
      const [response] = await Promise.all([
        page.waitForResponse(response =>
          response.request().resourceType() === 'image'
          && response.url().startsWith(wecomQrEndpoint + '?')
          && response.ok(),
        { timeout: 20_000 }),
        openWecomTab(),
      ])
      image = await response.body()
    }
  } catch {
    throw new CliError('QR_UNAVAILABLE', 'VELA 的企微扫码面板未能加载，请检查网络或网页是否有变化。')
  }
  if (image) {
    const { printTerminalQr } = await import('./terminal-qr.js')
    printTerminalQr(image)
  } else {
    process.stderr.write('请在打开的 Chrome 窗口中用企业微信扫码并确认。\n')
  }
}

export async function browserLogin(timeoutSeconds: number, showBrowser: boolean): Promise<Session> {
  const { chromium, errors } = await import('playwright')
  const browser = await chromium.launch({ channel: 'chrome', headless: !showBrowser }).catch(() => {
    throw new CliError('BROWSER_UNAVAILABLE', '无法启动 Chrome，请确认本机已安装 Google Chrome。')
  })
  try {
    const page = await browser.newPage()
    await page.goto(loginPage, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {
      throw new CliError('NETWORK_ERROR', 'Chrome 未能打开 VELA 登录页，请检查网络后重试。')
    })
    // Listen before selecting the tab so even a fast authorization is captured.
    const responsePromise = page.waitForResponse(
      response => response.url() === wecomLoginUrl && response.request().method() === 'POST',
      { timeout: timeoutSeconds * 1_000 },
    )
    const [response] = await Promise.all([responsePromise, showQr(page, showBrowser)])
    const payload: unknown = await response.json().catch(() => undefined)
    const session = parseSession(unwrap(payload, response.status(), 'login'))
    if (!session) throw new CliError('API_ERROR', 'VELA 未返回完整的扫码登录会话。')
    return session
  } catch (error) {
    if (error instanceof CliError) throw error
    if (error instanceof errors.TimeoutError) {
      throw new CliError('SCAN_TIMEOUT', '等待扫码确认超时，请重新运行 vela login。')
    }
    if (!browser.isConnected()) {
      throw new CliError('SCAN_CANCELLED', '扫码窗口已关闭，请重新运行 vela login。')
    }
    throw new CliError('BROWSER_ERROR', '扫码过程中 Chrome 连接中断，请重试。')
  } finally {
    await browser.close().catch(() => {})
  }
}
