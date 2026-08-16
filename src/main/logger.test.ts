import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { redactLogText } from './logRedaction'

describe('log redaction', () => {
  it('redacts common identifiers, secrets, and the home directory', () => {
    const input = [
      `${homedir()}/Library/Application Support/Codex Controller`,
      'device AA:BB:CC:DD:EE:FF',
      'id 123e4567-e89b-42d3-a456-426614174000',
      'token=keep-this-private',
      'Authorization: Bearer another-private-value'
    ].join(' ')

    const output = redactLogText(input)

    expect(output).toContain('~/Library/Application Support/Codex Controller')
    expect(output).toContain('[redacted-device-address]')
    expect(output).toContain('[redacted-identifier]')
    expect(output).toContain('token=[redacted]')
    expect(output).not.toContain('keep-this-private')
    expect(output).not.toContain('another-private-value')
  })

  it('bounds an unexpectedly large diagnostic message', () => {
    const output = redactLogText('x'.repeat(70 * 1024))

    expect(output.length).toBeLessThan(70 * 1024)
    expect(output).toContain('[truncated')
  })
})
