// "Report a problem" (owner, Nov 5): anyone sends one; only their own screenshots are kept; the owner marks it fixed.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase, getDoc } from './helpers'
import { cleanBugReport } from '../../functions/src/bugReports'

const OWNER = 'alexisricordi@gmail.com', ANA = 'ana@example.com', DEMO = 'dee@example.com', GEAR = 'gear@example.com'
const HOST = 'http://127.0.0.1:9199/v0/b/demo-proptracker.appspot.com/o/'

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${DEMO}`, { email: DEMO, role: 'creator', active: true, name: 'Dee', access: 'props' })
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true, name: 'Maanik' })
})

describe('report a problem', () => {
  it('keeps only the person\'s own screenshots and caps everything', () => {
    const mine = `${HOST}${encodeURIComponent(`bug-reports/${ANA}/1_screen.jpg`)}?alt=media`
    const theirs = `${HOST}${encodeURIComponent(`bug-reports/${DEMO}/1_screen.jpg`)}?alt=media`
    const r = cleanBugReport({ kind: 'missing', what: '  My Thursday shoot is gone ', screenshots: [mine, theirs, 'https://evil.example/x.jpg'],
      context: { page: '/schedule', trail: Array.from({ length: 30 }, (_, i) => `p${i}`), errors: ['x'.repeat(900)], width: 390.4, standalone: true } }, ANA, [HOST])
    expect(r.kind).toBe('missing')
    expect(r.what).toBe('My Thursday shoot is gone')
    expect(r.screenshots).toEqual([mine])
    expect(r.trail.length).toBe(12)
    expect(r.errors[0].length).toBe(400)
    expect(r.device).toMatchObject({ width: 390, standalone: true })
    expect(() => cleanBugReport({ kind: 'broken', what: 'x' }, ANA, [HOST])).toThrow()
  })

  it('creators (Props only too) and the teams can send; the owner marks it fixed', async () => {
    for (const who of [ANA, DEMO, GEAR]) {
      const r = await call('reportBug', { kind: 'broken', what: 'Send did nothing', context: { page: '/reserve' } }, who)
      expect(r.ok, r.message).toBe(true)
    }
    const r = await call('reportBug', { kind: 'wrong', what: 'Wrong time on my shoot', screenshots: [], context: { page: '/' } }, ANA)
    const doc = (await getDoc(`bug_reports/${r.result.id}`))!
    expect(doc).toMatchObject({ email: ANA, name: 'Ana', kind: 'wrong', status: 'open', page: '/' })
    expect((await call('updateBugReport', { id: r.result.id, status: 'fixed' }, ANA)).error).toBe('PERMISSION_DENIED')
    expect((await call('updateBugReport', { id: r.result.id, status: 'fixed', note: 'Times are right now' }, OWNER)).ok).toBe(true)
    expect((await getDoc(`bug_reports/${r.result.id}`))!).toMatchObject({ status: 'fixed', note: 'Times are right now', decidedBy: OWNER })
    expect((await call('reportBug', { kind: 'broken', what: '' }, ANA)).error).toBe('INVALID_ARGUMENT')
  })
})
