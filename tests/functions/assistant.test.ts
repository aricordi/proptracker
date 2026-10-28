// Creator AI helpers: video idea → props/gear (test mode answers), monthly budget and daily limit.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio } from '../../functions/src/booking'

const ANA = 'ana@example.com'
const month = todayInStudio().slice(0, 7)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put('gear_bundles/fx3', { name: 'FX3 kit', kind: 'bundle', archived: false, category: 'Camera', pieces: [] })
})

describe('video idea → props and gear', () => {
  it('answers with groups of real ids and counts the use', async () => {
    const r = await call('ideaToProps', { idea: 'A cop pulls over his friend at a diner' }, ANA)
    expect(r.ok).toBe(true)
    expect(r.result.groups.flatMap((g: any) => g.picks).some((p: any) => p.kind === 'gear' && p.id === 'fx3')).toBe(true)
    const m = (await getDoc(`ai_usage/${month}`))!
    expect(m.calls).toBe(1)
    expect((await getDoc(`ai_usage/${month}/people/${ANA}`))!.count).toBe(1)
  })
  it('"see more" never repeats what is already shown', async () => {
    await put('gear_bundles/light', { name: 'Light kit', kind: 'bundle', archived: false, category: 'Light', pieces: [] })
    const first = await call('ideaToProps', { idea: 'A cop pulls over his friend at a diner' }, ANA)
    expect(first.result.searched.length).toBeGreaterThan(0)
    const shown = first.result.groups.flatMap((g: any) => g.picks.map((p: any) => p.id))
    const more = await call('ideaToProps', { idea: 'A cop pulls over his friend at a diner', exclude: shown, searched: first.result.searched }, ANA)
    expect(more.ok).toBe(true)
    const again = more.result.groups.flatMap((g: any) => g.picks.map((p: any) => p.id))
    expect(again.some((id: string) => shown.includes(id))).toBe(false)
  })
  it('brainstorm follow-ups: a short ask works with the earlier messages, and gives a tip + next asks', async () => {
    const r = await call('ideaToProps', { idea: 'seance', history: ['A haunted house prank on my roommate'] }, ANA)
    expect(r.ok).toBe(true)
    expect(typeof r.result.reply).toBe('string')
    expect(Array.isArray(r.result.chips)).toBe(true)
    expect((await call('ideaToProps', { idea: 'abc' }, ANA)).message).toMatch(/a little more/)
  })
  it('needs a real idea', async () => {
    expect((await call('ideaToProps', { idea: 'hi' }, ANA)).message).toMatch(/a little more/)
  })
})

describe('limits', () => {
  it('daily limit per person', async () => {
    await put('app_settings/ai', { monthlyCapUsd: 50, perPersonDaily: 1 })
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, ANA)).ok).toBe(true)
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, ANA)).message).toMatch(/today's AI help/)
  })
  it('no more than 6 uses a minute', async () => {
    for (let i = 0; i < 6; i++) expect((await call('ideaToProps', { idea: `Bank heist number ${i}` }, ANA)).ok).toBe(true)
    expect((await call('ideaToProps', { idea: 'Bank heist again' }, ANA)).message).toMatch(/Wait a minute/)
  })
  it('monthly budget', async () => {
    await put('app_settings/ai', { monthlyCapUsd: 0.01, perPersonDaily: 25 })
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, ANA)).message).toMatch(/resting until the 1st/)
  })
})

describe('props-only (demo) creators', () => {
  const DEE = 'dee@example.com'
  beforeEach(async () => { await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' }) })
  it('get prop ideas only: no gear, no shoot, counted on their own budget', async () => {
    await put('items/hat', { name: 'Top hat', collection: 'company', quantity: 1, archived: false })
    const r = await call('ideaToProps', { idea: 'A magician show with a top hat', shootId: 'whatever' }, DEE)
    expect(r.ok).toBe(true)
    expect(r.result.groups.flatMap((g: any) => g.picks).some((p: any) => p.kind === 'gear')).toBe(false)
    const m = (await getDoc(`ai_usage/${month}`))!
    expect(m.by.demo).toBe(1)
    expect(m.demoSpentUsd).toBe(m.spentUsd)   // test mode costs nothing, but it is tracked separately
  })
  it('stop at their own budget while full-app creators keep going', async () => {
    await put('app_settings/ai', { monthlyCapUsd: 50, perPersonDaily: 25, demoMonthlyCapUsd: 0.01 })
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, DEE)).message).toMatch(/resting until the 1st/)
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, ANA)).ok).toBe(true)
  })
  it('have their own (smaller) daily limit', async () => {
    await put('app_settings/ai', { monthlyCapUsd: 50, perPersonDaily: 25, demoPerPersonDaily: 1 })
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, DEE)).ok).toBe(true)
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, DEE)).message).toMatch(/today's AI help \(1 times\)/)
  })
  it('still cannot find times or book', async () => {
    expect((await call('askForTime', { text: 'two hours next week' }, DEE)).error).toBe('PERMISSION_DENIED')
  })
})
