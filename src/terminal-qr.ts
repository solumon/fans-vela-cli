import { styleText } from 'node:util'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'
import stringWidth from 'string-width'
import { CliError } from './vela.js'

export function printTerminalQr(image: Buffer, timeoutSeconds: number) {
  const { data, width, height } = PNG.sync.read(image)
  const decoded = jsQR.default(new Uint8ClampedArray(data), width, height)
  if (!decoded) {
    throw new CliError('QR_DISPLAY_ERROR', '无法读取企微二维码，请重试或使用 vela login --browser。')
  }

  const standard = QRCode.create(decoded.data, { errorCorrectionLevel: 'M' }).modules
  const compact = QRCode.create(decoded.data, { errorCorrectionLevel: 'L' }).modules
  const modules = compact.size < standard.size ? compact : standard
  const margin = 4
  const columns = modules.size + margin * 2
  const stream = process.stderr
  if (stream.columns && stream.columns < columns) {
    throw new CliError('QR_DISPLAY_ERROR', `请将终端加宽至至少 ${columns} 列，或运行 vela login --browser。`)
  }

  const isDark = (row: number, column: number) =>
    row >= 0 && row < modules.size && column >= 0 && column < modules.size
    && Boolean(modules.get(row, column))
  const colorDepth = stream.getColorDepth?.() ?? 0
  const qrColors = colorDepth >= 24 ? '\x1b[38;2;0;0;0;48;2;255;255;255m'
    : colorDepth >= 8 ? '\x1b[38;5;16;48;5;231m'
      : '\x1b[30;107m'
  const qr = []
  for (let row = -margin; row < modules.size + margin; row += 2) {
    let line = qrColors
    for (let column = -margin; column < modules.size + margin; column++) {
      const top = isDark(row, column)
      const bottom = isDark(row + 1, column)
      line += top ? (bottom ? '█' : '▀') : (bottom ? '▄' : ' ')
    }
    qr.push(line + '\x1b[0m')
  }

  const title = styleText(['bold', 'blueBright'], 'VELA · 企业微信登录', { stream })
  const steps = [
    `${styleText('blueBright', '01', { stream })}  打开企业微信，扫描二维码`,
    `${styleText('blueBright', '02', { stream })}  在手机上确认登录`,
  ]
  const status = styleText('yellowBright', `扫码时限 ${timeoutSeconds} 秒`, { stream })
  const innerWidth = Math.max(columns, stringWidth(title), ...steps.map(stringWidth)) + 2
  if (!stream.isTTY || (stream.columns && stream.columns < innerWidth + 2)) {
    stream.write([title, '', ...qr, '', ...steps, '', status, ''].join('\n'))
    return
  }

  const border = (value: string) => styleText('blueBright', value, { stream })
  const rule = '─'.repeat(innerWidth)
  const row = (value: string, centered = false) => {
    const remaining = innerWidth - stringWidth(value)
    const left = centered ? Math.floor(remaining / 2) : 1
    return border('│') + ' '.repeat(left) + value + ' '.repeat(remaining - left) + border('│')
  }
  stream.write([
    border(`╭${rule}╮`),
    row(title),
    ...qr.map(line => row(line, true)),
    border(`├${rule}┤`),
    ...steps.map(step => row(step)),
    border(`╰${rule}╯`),
    `  ${status}`,
    '',
  ].join('\n'))
}
