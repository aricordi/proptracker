// The AI's app guide must cover every screen (owner, Oct 28: "it has to be updated every time we make changes").
// If this fails, a screen was added or renamed without telling the AI: add/update its entry in functions/src/appGuide.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GUIDE, NOT_SCREENS, guideFor, searchGuide, TABS } from '../../functions/src/appGuide'

const routes = [...new Set([...readFileSync('src/App.tsx', 'utf8').matchAll(/path="([^"]+)"/g)].map(m => m[1]))]

describe('app guide', () => {
  it('has an entry for every screen in the app', () => {
    const covered = new Set([...GUIDE.map(e => e.path).filter(Boolean), ...NOT_SCREENS])
    expect(routes.filter(r => !covered.has(r))).toEqual([])
  })
  it('only points at screens that exist', () => {
    expect(GUIDE.map(e => e.path).filter((p): p is string => !!p && !routes.includes(p))).toEqual([])
  })
  it('has unique ids, a role for every entry, and tabs for every role', () => {
    expect(new Set(GUIDE.map(e => e.id)).size).toBe(GUIDE.length)
    expect(GUIDE.every(e => e.who.length > 0 && e.about.length > 20)).toBe(true)
    for (const r of ['owner', 'admin', 'arts', 'equipment', 'creator', 'demo'] as const) expect(TABS[r]).toBeTruthy()
  })
  it('never shows staff or owner screens to creators', () => {
    const ids = guideFor('creator').map(e => e.id)
    for (const staff of ['queue', 'users', 'analytics', 'connections', 'costs', 'allgear', 'scheduleteam']) expect(ids).not.toContain(staff)
    const demo = guideFor('demo').map(e => e.id)
    expect(demo).not.toContain('book'); expect(demo).not.toContain('reserve')
  })
  it('finds the right screen without the AI', () => {
    expect(searchGuide('how do I return my gear?', guideFor('creator'))[0].id).toMatch(/return|gearbooking/)
    expect(searchGuide('where do I see my requests', guideFor('creator')).map(e => e.id)).toContain('requests')
    expect(searchGuide('how do I invite someone', guideFor('creator')).map(e => e.id)).not.toContain('users')
  })
})
