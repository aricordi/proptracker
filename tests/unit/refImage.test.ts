// Reference pictures for custom props (owner, Nov 24): only fetched from ChatGPT's own file servers.
import { describe, it, expect } from 'vitest'
import { refImageHostOk, refImageLink } from '../../functions/src/mcp/refImage'

describe('reference picture links', () => {
  it('only ChatGPT file servers, https, no tricks', () => {
    expect(refImageHostOk('https://files.oaiusercontent.com/file-abc?se=1&sig=x')).toBe(true)
    expect(refImageHostOk('https://sdmntprwestus.oaiusercontent.com/files/x.png')).toBe(true)
    expect(refImageHostOk('http://files.oaiusercontent.com/x')).toBe(false)
    expect(refImageHostOk('https://evil.com/x.png')).toBe(false)
    expect(refImageHostOk('https://oaiusercontent.com.evil.com/x')).toBe(false)
    expect(refImageHostOk('https://user:pw@files.oaiusercontent.com/x')).toBe(false)
    expect(refImageHostOk('https://169.254.169.254/latest')).toBe(false)
    expect(refImageHostOk('https://metadata.google.internal/x')).toBe(false)
    expect(refImageHostOk(42)).toBe(false)
  })
  it('a plain link or ChatGPT\'s file object', () => {
    expect(refImageLink({ download_url: 'https://files.oaiusercontent.com/a', file_id: 'file_1' })).toBe('https://files.oaiusercontent.com/a')
    expect(refImageLink(' https://x ')).toBe('https://x')
    expect(refImageLink(null)).toBe('')
  })
})
