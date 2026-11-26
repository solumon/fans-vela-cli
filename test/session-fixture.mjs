import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { protectWindowsData } from '../src/windows-dpapi.ts'

export const isWindows = process.platform === 'win32'
const encryptedFixtures = new Map()

export function sessionFixture(stateHome) {
  const dir = join(stateHome, '.vela')
  const path = join(dir, isWindows ? 'auth.dpapi' : 'auth.json')
  return {
    path,
    read() {
      const data = readFileSync(path)
      return JSON.parse((isWindows ? protectWindowsData('Unprotect', data) : data).toString('utf8'))
    },
    write(session) {
      mkdirSync(dir, { mode: 0o700, recursive: true })
      const json = JSON.stringify(session)
      let data = json
      if (isWindows) {
        if (!encryptedFixtures.has(json)) encryptedFixtures.set(json, protectWindowsData('Protect', Buffer.from(json)))
        data = encryptedFixtures.get(json)
      }
      writeFileSync(path, data, { mode: 0o600 })
    },
  }
}
