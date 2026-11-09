import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'
import { CliError } from './vela.js'

export function printTerminalQr(image: Buffer) {
  const { data, width, height } = PNG.sync.read(image)
  const decoded = jsQR.default(new Uint8ClampedArray(data), width, height)
  if (!decoded) {
    throw new CliError('QR_DISPLAY_ERROR', '无法读取企微二维码，请重试或使用 vela login --browser。')
  }

  const { modules } = QRCode.create(decoded.data, { errorCorrectionLevel: 'M' })
  const margin = 4
  const columns = modules.size + margin * 2
  if (process.stderr.columns && process.stderr.columns < columns) {
    throw new CliError('QR_DISPLAY_ERROR', `请将终端加宽至至少 ${columns} 列后重试。`)
  }

  const isDark = (row: number, column: number) =>
    row >= 0 && row < modules.size && column >= 0 && column < modules.size
    && Boolean(modules.get(row, column))
  const lines = []
  for (let row = -margin; row < modules.size + margin; row += 2) {
    let line = '\x1b[30;107m'
    for (let column = -margin; column < modules.size + margin; column++) {
      const top = isDark(row, column)
      const bottom = isDark(row + 1, column)
      line += top ? (bottom ? '█' : '▀') : (bottom ? '▄' : ' ')
    }
    lines.push(line + '\x1b[0m')
  }

  process.stderr.write('请用企业微信扫描下方二维码，并在手机上确认登录。\n\n' + lines.join('\n') + '\n\n')
}
