import { execFileSync } from 'node:child_process'
import {
  existsSync,
  renameSync,
  rmSync
} from 'node:fs'
import { resolve } from 'node:path'

const appName = 'Codex Controller.app'
const expectedBundleId = 'com.parthjadhav.CodexController'
const legacyAppName = 'Codex Control Deck.app'
const legacyBundleId = 'com.parthjadhav.ControllerControls'
const applicationsDirectory = '/Applications'
const targetApp = `${applicationsDirectory}/${appName}`
const legacyTargetApp = `${applicationsDirectory}/${legacyAppName}`
const sourceArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
const sourceApp = resolve(sourceArgument ?? `dist/mac-universal/${appName}`)
const dryRun = process.argv.includes('--dry-run')
const plistBuddy = '/usr/libexec/PlistBuddy'

const bundleId = (appPath) =>
  execFileSync(
    plistBuddy,
    ['-c', 'Print :CFBundleIdentifier', `${appPath}/Contents/Info.plist`],
    { encoding: 'utf8' }
  ).trim()

if (!existsSync(sourceApp)) {
  throw new Error(`Packaged app not found: ${sourceApp}. Run npm run package first.`)
}

const sourceBundleId = bundleId(sourceApp)
if (sourceBundleId !== expectedBundleId) {
  throw new Error(
    `Refusing to install ${sourceApp}: expected bundle ${expectedBundleId}, found ${sourceBundleId}.`
  )
}

const existingApp = existsSync(targetApp)
  ? targetApp
  : existsSync(legacyTargetApp)
    ? legacyTargetApp
    : undefined

if (existingApp) {
  const installedBundleId = bundleId(existingApp)
  const expectedInstalledBundleId = existingApp === targetApp ? expectedBundleId : legacyBundleId
  if (installedBundleId !== expectedInstalledBundleId) {
    throw new Error(
      `Refusing to replace ${existingApp}: it belongs to ${installedBundleId}, not ${expectedInstalledBundleId}.`
    )
  }
}

if (dryRun) {
  console.log(
    `Verified ${sourceApp} can safely ${existingApp === legacyTargetApp ? 'migrate' : 'update'} ${targetApp}.`
  )
  process.exit(0)
}

const stagingApp = `${applicationsDirectory}/.Codex Controller.installing-${process.pid}.app`
const backupApp = `${applicationsDirectory}/.Codex Controller.backup-${process.pid}.app`

try {
  execFileSync('/usr/bin/ditto', [sourceApp, stagingApp], { stdio: 'inherit' })
  if (existingApp) renameSync(existingApp, backupApp)
  renameSync(stagingApp, targetApp)
  if (existsSync(backupApp)) rmSync(backupApp, { recursive: true })
} catch (error) {
  if (!existsSync(existingApp ?? targetApp) && existsSync(backupApp)) {
    renameSync(backupApp, existingApp ?? targetApp)
  }
  throw error
} finally {
  if (existsSync(stagingApp)) rmSync(stagingApp, { recursive: true })
}

console.log(`Installed ${expectedBundleId} at ${targetApp}.`)
