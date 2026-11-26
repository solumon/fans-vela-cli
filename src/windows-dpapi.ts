import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export function protectWindowsData(method: 'Protect' | 'Unprotect', data: Buffer): Buffer {
  // Use standard input and output to keep session tokens out of command-line arguments.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$result = [Security.Cryptography.ProtectedData]::${method}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Write([Convert]::ToBase64String($result))
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: data.toString('base64'),
    encoding: 'ascii',
    timeout: 10_000,
    windowsHide: true,
  })
  if (result.status !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.stdout)) {
    throw new Error('Windows DPAPI operation failed')
  }
  return Buffer.from(result.stdout, 'base64')
}
