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
  it('monthly budget', async () => {
    await put('app_settings/ai', { monthlyCapUsd: 0.01, perPersonDaily: 25 })
    expect((await call('ideaToProps', { idea: 'Bank heist gone wrong' }, ANA)).message).toMatch(/budget is used up/)
  })
})
