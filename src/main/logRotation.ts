import { existsSync, renameSync, rmSync } from 'node:fs'
import { join, parse } from 'node:path'

/**
 * Moves `main.log` to `main.1.log` and shifts older archives up by one.
 *
 * Rotation is deliberately synchronous because electron-log resets its file
 * handle immediately after this callback returns. Keeping the implementation
 * here, outside Electron, also makes the retention boundary straightforward to
 * exercise in a real filesystem test.
 */
export const rotateLogFiles = (activePath: string, archiveCount: number): void => {
  if (!Number.isSafeInteger(archiveCount) || archiveCount < 1) {
    throw new Error('Log archive count must be a positive integer.')
  }

  const { dir, name, ext } = parse(activePath)
  const archivePath = (number: number): string => join(dir, `${name}.${number}${ext}`)

  const oldest = archivePath(archiveCount)
  if (existsSync(oldest)) rmSync(oldest)

  for (let number = archiveCount - 1; number >= 1; number -= 1) {
    const current = archivePath(number)
    if (existsSync(current)) renameSync(current, archivePath(number + 1))
  }

  if (existsSync(activePath)) renameSync(activePath, archivePath(1))
}
