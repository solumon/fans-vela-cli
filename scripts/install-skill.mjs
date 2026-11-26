import { cp, lstat, mkdir, readFile, realpath, rename, stat, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillName = 'fans-vela-daily-register'
const source = fileURLToPath(new URL(`../.agents/skills/${skillName}`, import.meta.url))
const sourceSkill = await readFile(join(source, 'SKILL.md'))
const home = homedir()
const shared = join(home, '.agents', 'skills', skillName)

async function ifExists(operation) {
  try {
    return await operation()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function backup(target) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destination = `${target}.bak-${timestamp}`
  await rename(target, destination)
  console.log(`已备份到 ${destination}`)
}

async function installCopy(target) {
  const existing = await ifExists(() => lstat(target))
  if (existing) {
    const skill = existing.isDirectory() && await ifExists(() => readFile(join(target, 'SKILL.md')))
    if (!skill || !sourceSkill.equals(skill)) await backup(target)
  }
  await cp(source, target, {
    recursive: true,
    filter: path => !['.DS_Store', '__MACOSX'].includes(basename(path)),
  })
  console.log(`已安装技能到 ${target}`)
}

await installCopy(shared)
for (const [label, directory] of [['Cursor', '.cursor'], ['Codex', '.codex'], ['Hermes', '.hermes']]) {
  const host = join(home, directory)
  if (!(await ifExists(() => stat(host)))?.isDirectory()) {
    console.log(`跳过 ${label}（未找到 ${host}）`)
    continue
  }
  const target = join(host, 'skills', skillName)
  if (process.platform === 'win32') {
    await installCopy(target)
    continue
  }

  const existing = await ifExists(() => lstat(target))
  if (existing?.isSymbolicLink() && await ifExists(() => realpath(target)) === await realpath(shared)) continue
  if (existing) await backup(target)
  await mkdir(dirname(target), { recursive: true })
  await symlink(shared, target, 'dir')
  console.log(`已链接 ${target}`)
}

console.log('OpenCode 可读取通用技能目录。WorkBuddy 可导入 npm run pack:release 生成的 ZIP。')
