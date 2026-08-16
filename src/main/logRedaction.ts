import { homedir } from 'node:os'
import { sep } from 'node:path'

const macAddress = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const bearerToken = /\bbearer\s+[a-z0-9._~+/=-]+/gi
const secretAssignment =
  /\b(api[-_ ]?key|authorization|bearer|password|secret|token)(\s*[:=]\s*|\s+)[^\s,;]+/gi
const maximumTextCharacters = 64 * 1024
const maximumCollectionEntries = 100
const maximumObjectDepth = 6

export const redactLogText = (text: string): string => {
  const home = homedir()
  const homePrefix = home.endsWith(sep) ? home : `${home}${sep}`
  const bounded =
    text.length > maximumTextCharacters
      ? `${text.slice(0, maximumTextCharacters)}… [truncated ${text.length - maximumTextCharacters} characters]`
      : text
  return bounded
    .split(homePrefix)
    .join(`~${sep}`)
    .replace(macAddress, '[redacted-device-address]')
    .replace(uuid, '[redacted-identifier]')
    .replace(bearerToken, 'Bearer [redacted]')
    .replace(secretAssignment, '$1$2[redacted]')
}

export const redactLogValue = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown => {
  if (typeof value === 'string') return redactLogText(value)
  if (value instanceof Error) {
    const redacted = new Error(redactLogText(value.message))
    redacted.name = value.name
    if (value.stack) redacted.stack = redactLogText(value.stack)
    return redacted
  }
  if (typeof value !== 'object' || value === null) return value
  if (depth >= maximumObjectDepth) return '[maximum log depth reached]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const entries = value
      .slice(0, maximumCollectionEntries)
      .map((entry) => redactLogValue(entry, seen, depth + 1))
    if (value.length > maximumCollectionEntries) {
      entries.push(`[${value.length - maximumCollectionEntries} entries omitted]`)
    }
    return entries
  }
  const entries = Object.entries(value).slice(0, maximumCollectionEntries)
  const redacted = Object.fromEntries(
    entries.map(([key, entry]) => [key, redactLogValue(entry, seen, depth + 1)])
  )
  if (Object.keys(value).length > maximumCollectionEntries) {
    redacted['[truncated]'] = `${Object.keys(value).length - maximumCollectionEntries} entries omitted`
  }
  return redacted
}
