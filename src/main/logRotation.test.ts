import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rotateLogFiles } from './logRotation'

const temporaryDirectories: string[] = []

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-controller-logs-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('log rotation', () => {
  it('keeps only the configured number of archives in newest-first order', () => {
    const directory = temporaryDirectory()
    const active = join(directory, 'main.log')
    for (let number = 1; number <= 3; number += 1) {
      writeFileSync(join(directory, `main.${number}.log`), `archive ${number}`)
    }
    writeFileSync(active, 'current')

    rotateLogFiles(active, 3)

    expect(readFileSync(join(directory, 'main.1.log'), 'utf8')).toBe('current')
    expect(readFileSync(join(directory, 'main.2.log'), 'utf8')).toBe('archive 1')
    expect(readFileSync(join(directory, 'main.3.log'), 'utf8')).toBe('archive 2')
  })

  it('rejects a retention policy that cannot retain an archive', () => {
    expect(() => rotateLogFiles('/tmp/main.log', 0)).toThrow(
      'Log archive count must be a positive integer.'
    )
  })
})
