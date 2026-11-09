import { stripVTControlCharacters, styleText } from 'node:util'
import Table from 'cli-table3'
import ora from 'ora'
import stringWidth from 'string-width'
import type { DayReport, Project, hoursCommand } from './hours.js'
import type { TaskAppResult, TaskDetails } from './task.js'
import type { CliError } from './vela.js'

export class TerminalUi {
  private spinner?: ReturnType<typeof ora>
  private pending?: ReturnType<typeof setTimeout>

  constructor(readonly interactive: boolean) {}

  wait(message: string) {
    const stream = process.stderr
    if (!this.interactive || !stream.isTTY || process.env.TERM === 'dumb') return
    if (this.spinner?.isSpinning) {
      this.spinner.text = message
      return
    }
    clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      this.spinner ??= ora({ stream, color: 'cyan', discardStdin: false, hideCursor: false })
      this.spinner.start(message)
    }, 120).unref()
  }

  stop() {
    clearTimeout(this.pending)
    this.spinner?.stop()
  }
}

export function formatHelp(interactive: boolean) {
  const section = (value: string) => interactive ? styleText(['bold', 'cyanBright'], value) : value
  const entry = (command: string, description: string) =>
    '  ' + command + ' '.repeat(Math.max(2, 42 - stringWidth(command))) + description
  return [
    section('VELA · 项目与工时'),
    '',
    section('账号'),
    entry('vela login [--timeout 秒] [--browser]', '扫码登录'),
    entry('vela auth status', '查看登录账号'),
    entry('vela logout', '退出登录'),
    '',
    section('开发任务'),
    entry('vela task get <任务编号>', '查看开发任务详情'),
    entry('vela task app add <任务编号> --app <应用名>', '预览添加应用'),
    '',
    section('工作日报'),
    entry('vela hours day [--date YYYY-MM-DD]', '查看日报'),
    entry('vela hours projects', '查看可填报项目'),
    '  vela hours submit --date YYYY-MM-DD --file <文件|->',
    '    预览填报，确认后在原命令末尾加 --apply <previewId>。',
    '',
    section('通用选项'),
    '  --help, -h    显示帮助',
    '  --json        输出单行 JSON，管道和重定向时自动使用',
    '',
    '扫码默认等待 180 秒，--browser 可在 Chrome 中显示二维码。',
  ].join('\n')
}

export function formatAccount(nickname: string | undefined, login: boolean) {
  if (nickname === undefined) return styleText(['bold', 'greenBright'], '✓ 已退出 VELA')
  const title = styleText(['bold', 'greenBright'], login ? '✓ 登录成功' : '✓ VELA 已登录')
  return `${title}\n账号  ${terminalText(nickname)}`
}

export function formatError(problem: CliError) {
  const title = styleText(['bold', 'redBright'], '× ' + terminalText(problem.message))
  return `${title}\n  ${problem.code}`
}

function terminalText(value: string) {
  return stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
}

export function formatTaskHelp() {
  return [
    '开发任务',
    '',
    '  vela task get <任务编号> [--json]    查看开发任务详情',
    '  vela task app add <任务编号> (--app <应用名> | --app-id <应用ID>)',
    '    [--branch <分支>] [--version <版本>] [--apply <previewId>] [--json]',
    '    分支默认 dev。先预览，确认后在原命令末尾加 --apply <previewId>。',
  ].join('\n')
}

export function formatTaskApp(result: TaskAppResult, columns: number | undefined) {
  const { devTaskId, taskName, appId, appName, submitGitBranch, version } = result.taskApp
  const fields = [
    ['任务', `#${devTaskId}  ${terminalText(taskName)}`],
    ['应用', `#${appId}  ${terminalText(appName)}`],
    ['提测分支', terminalText(submitGitBranch)],
    ['版本号', version ?? '—'],
  ]
  const width = Math.min(Math.max(columns || 80, 12), 100)
  const table = formatTaskFields(fields, width)
  if (result.submitted) return styleText(['bold', 'greenBright'], '✓ 已添加应用并回查确认') + '\n' + table
  const title = styleText(['bold', 'yellowBright'], '添加应用预览 · 尚未提交')
  return [title, table, '确认后，在原命令末尾加', `  --apply ${result.previewId}`].join('\n')
}

export function formatTask(
  { task, applications, members, plan, attachments, history }: TaskDetails,
  columns: number | undefined,
) {
  const text = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return '—'
    return terminalText(String(value)).trim() || '—'
  }
  const shanghaiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' })
  const date = (value: unknown) => typeof value === 'number' && Number.isFinite(new Date(value).getTime())
    ? shanghaiDate.format(value)
    : text(value)
  const statuses = new Map([
    ['0', '未开始'], ['1', '开发中'], ['2', '已提测'], ['3', '已上线'], ['4', '已取消'],
  ])
  const status = text(task.status)
  const fields = [
    ['任务编号', text(task.id)],
    ['任务标题', text(task.taskName)],
    ['状态', statuses.get(status) ?? status],
    ['所属项目', text(task.projectName)],
    ['项目负责人', text(task.projectOwnerNickname)],
    ['开发负责人', text(task.ownerNickname)],
    ['开发启动', date(task.devStartTime)],
    ['预计提测', date(task.testSubmitPlanTime)],
    ['开发成员', members.map(member => text(member.nickname)).join('、') || '—'],
    ['开发计划', `${plan.length} 项`],
    ['附件', `${attachments.length} 个`],
    ['变更历史', `${history.length} 条`],
  ]
  const width = Math.min(Math.max(columns || 80, 12), 100)
  const details = formatTaskFields(fields, width)

  const appColumns = ['应用名称', '提测 Git 分支', '版本号']
  const apps = applications.map(app => [text(app.appName), text(app.submitGitBranch), text(app.version)])
  const branchWidth = Math.max(13, Math.floor((width - 20) / 3))
  const appTable = width >= 44
    ? formatTaskTable(appColumns, apps, [width - branchWidth - 20, branchWidth, 10])
    : formatTaskTable(['应用信息'], apps.map(([name, branch, version]) => [
      `${name}\n提测分支 ${branch}\n版本号 ${version}`,
    ]), [width - 4])

  return [
    styleText(['bold', 'cyanBright'], '开发任务'),
    details,
    '',
    styleText(['bold', 'cyanBright'], `关联应用（${applications.length}）`),
    applications.length ? appTable : '暂无关联应用。',
  ].join('\n')
}

function formatTaskFields(fields: string[][], width: number) {
  return width >= 29
    ? formatTaskTable(['字段', '内容'], fields, [10, width - 17])
    : formatTaskTable(['任务信息'], fields.map(([label, value]) => [`${label}\n${value}`]), [width - 4])
}

function formatTaskTable(headings: string[], rows: string[][], widths: number[]) {
  const table = new Table({
    head: headings.map((label, index) => styleText(['bold', 'blueBright'], wrapTableCell(label, widths[index]))),
    colWidths: widths.map(width => width + 2),
    chars: { 'top-left': '╭', 'top-right': '╮', 'bottom-left': '╰', 'bottom-right': '╯' },
    style: { compact: headings.length > 1, head: [], border: [] },
  })
  for (const row of rows) table.push(row.map((value, index) => wrapTableCell(value, widths[index])))
  return table.toString()
}

const graphemes = new Intl.Segmenter()

function wrapTableCell(value: string, columns: number) {
  const lines = []
  for (const source of value.split('\n')) {
    let line = ''
    let width = 0
    for (const { segment } of graphemes.segment(source)) {
      const segmentWidth = stringWidth(segment)
      if (width + segmentWidth > columns) {
        lines.push(line)
        line = ''
        width = 0
      }
      line += segment
      width += segmentWidth
    }
    lines.push(line)
  }
  return lines.join('\n')
}

function formatDay({ date, totalHours, cards }: DayReport, columns: number | undefined) {
  const hours = (value: number | null) => value === null ? '—' : `${value} 小时`
  const title = `${styleText(['bold', 'magentaBright'], '工作日报')}  ${date}`
  const total = styleText(['bold', 'cyanBright'], hours(totalHours))
  const header = `${title}\n合计 ${total}`
  if (cards.length === 0) return header + '\n\n当天暂无项目。'

  const headings = [
    styleText(['bold', 'blueBright'], '项目'),
    styleText(['bold', 'cyanBright'], '手填工时'),
    styleText(['bold', 'magentaBright'], '待办工时'),
    styleText(['bold', 'greenBright'], '进度'),
    styleText('bold', '工作内容'),
  ]
  const width = Math.max(columns || 80, 12)
  const metricWidths = [8, 8, 4]
  // Reserve two spaces of padding per cell and one border per column plus the outer border.
  const textWidth = width - (headings.length * 3 + 1) - metricWidths.reduce((sum, value) => sum + value, 0)
  const wide = textWidth >= 16
  const [projectWidth, ...detailWidths] = wide
    ? [Math.floor(textWidth / 2), ...metricWidths, Math.ceil(textWidth / 2)]
    : [width - 4]
  const table = new Table({
    head: wide ? headings : [styleText(['bold', 'blueBright'], '项目日报')],
    chars: { 'top-left': '╭', 'top-right': '╮', 'bottom-left': '╰', 'bottom-right': '╯' },
    colAligns: wide ? ['left', 'right', 'right', 'right', 'left'] : ['left'],
    style: { compact: wide, head: [], border: [] },
  })

  for (const card of cards) {
    const project = `${terminalText(card.projectName)}  #${card.projectId}`
    const projectCell = styleText(['bold', 'blueBright'], wrapTableCell(project, projectWidth))
    const manual = card.filled ? hours(card.hours) : '未填报'
    const todo = card.filled ? hours(card.todoHours) : '—'
    const progress = card.progress === null ? '—' : `${card.progress}%`
    const content = card.content?.trim().split(/\r\n|[\r\n]/).map(terminalText).join('\n') || '—'
    if (wide) {
      const [manualCell, todoCell, progressCell, contentCell] = [manual, todo, progress, content]
        .map((value, index) => wrapTableCell(value, detailWidths[index]))
      table.push([
        projectCell,
        styleText(card.filled ? 'cyanBright' : 'yellowBright', manualCell),
        card.todoHours > 0 ? styleText('magentaBright', todoCell) : todoCell,
        card.progress === null ? progressCell : styleText('greenBright', progressCell),
        contentCell,
      ])
      continue
    }
    const summary = card.filled ? `手填 ${manual} · 待办 ${todo} · 进度 ${progress}` : manual
    const lines = [projectCell, styleText(card.filled ? 'cyanBright' : 'yellowBright', wrapTableCell(summary, projectWidth))]
    if (card.filled) lines.push(wrapTableCell(content, projectWidth))
    table.push([lines.join('\n')])
  }
  return header + '\n\n' + table.toString()
}

function formatProjects(projects: Project[], columns: number | undefined) {
  if (projects.length === 0) return '暂无可填报项目。'

  const table = new Table({
    head: ['项目 ID', '项目名'].map(label => styleText(['bold', 'blueBright'], label)),
    chars: { 'top-left': '╭', 'top-right': '╮', 'bottom-left': '╰', 'bottom-right': '╯' },
    style: { compact: true, head: [], border: [] },
  })
  const rows = projects.map(({ projectId, projectName }) => [String(projectId), terminalText(projectName)])
  for (const row of rows) table.push(row)
  const output = table.toString()
  if (columns && output.indexOf('\n') > columns) {
    return rows.map(row => row.join('  ')).join('\n')
  }
  return output
}

type HoursResult = Awaited<ReturnType<typeof hoursCommand>>

export function formatHours(result: HoursResult, columns: number | undefined) {
  if (result.projects) return formatProjects(result.projects, columns)
  if ('changes' in result && result.changes) {
    const title = styleText(['bold', 'yellowBright'], `填报预览  ${result.date} · 尚未提交`)
    if (result.changes.length === 0) return title + '\n没有需要提交的变更。'

    const sections = result.changes.map(({ projectName, projectId, action, before, after }) => {
      const kind = action === 'create' ? '新增' : '修改'
      const project = styleText(['bold', 'blueBright'], `${kind}  ${terminalText(projectName)}  #${projectId}`)
      const lines = [project]
      if (before?.hours !== after.hours) {
        const value = before ? `${before.hours} → ${after.hours}` : String(after.hours)
        lines.push(`  手填工时  ${value} 小时`)
      }
      if (before?.progress !== after.progress) {
        const value = before ? `${before.progress}% → ${after.progress}%` : `${after.progress}%`
        lines.push(`  进度      ${value}`)
      }
      if (before?.content !== after.content) {
        if (before) lines.push(`  原内容    ${terminalText(before.content)}`)
        lines.push(`  工作内容  ${terminalText(after.content)}`)
      }
      return lines.join('\n')
    })
    const apply = `确认后，在原命令末尾加\n  --apply ${result.previewId}`
    return [title, ...sections, apply].join('\n\n')
  }
  const report = formatDay(result, columns)
  if (result.submitted === undefined) return report
  const status = result.submitted
    ? styleText(['bold', 'greenBright'], '✓ 已提交并核对')
    : styleText('yellowBright', '没有需要提交的变更。')
  return status + '\n\n' + report
}
