import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const release = resolve(root, process.argv[2] || 'release')
const npmPath = process.env.npm_execpath
if (!npmPath) throw new Error('请使用 npm run pack:release 运行打包脚本。')

const { name, version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const skillName = 'fans-vela-daily-register'
const skillArchive = `${skillName}-${version}.zip`
const cliArchive = `${name}-${version}.tgz`
await mkdir(release, { recursive: true })
const staging = await mkdtemp(join(release, '.pack-'))
try {
  const skillDirectory = join(root, '.agents', 'skills')
  const zipPath = join(staging, skillArchive)
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-caf', skillArchive, '--exclude', '.DS_Store', '--exclude', '__MACOSX', '-C', skillDirectory, skillName], {
      cwd: staging, stdio: 'inherit', windowsHide: true,
    })
  } else {
    execFileSync('zip', ['-qrX', zipPath, skillName, '-x', '*/.DS_Store', '*/__MACOSX/*'], {
      cwd: skillDirectory, stdio: 'inherit',
    })
  }
  execFileSync(process.execPath, [npmPath, 'pack', '--pack-destination', staging], { cwd: root, stdio: 'inherit' })
  await rename(join(staging, cliArchive), join(release, cliArchive))
  await rename(zipPath, join(release, skillArchive))
  console.log(`发布包已生成于 ${release}`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
