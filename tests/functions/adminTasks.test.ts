// Admin tasks: the GitHub "Admin task" button writes admin_tasks/{id}; the trigger imports as the owner with the same code.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, getDoc, clearDatabase } from './helpers'

async function waitFor(path: string, done: (d: Record<string, unknown> | undefined) => boolean, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const d = await getDoc(path)
    if (done(d)) return d
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${path}`)
}

beforeEach(async () => {
  await clearDatabase()
  await put('categories/prop', { label: 'Prop', active: true, order: 0 })
  await put('locations/loc-main', { name: 'Main prop room' })
  await put('bins/b1', { label: 'A1', locationId: 'loc-main', qrSlug: 'b1' })
})

describe('admin tasks', () => {
  it('imports folders in order as the owner; a second run of the same folder queues nothing', async () => {
    await put('admin_tasks/t1', { kind: 'import', steps: [{ link: 'test:3', place: 'Prop rack' }], createdAt: 'x' })
    const t = await waitFor('admin_tasks/t1', d => d?.status === 'done' || d?.status === 'failed')
    expect(t!.status).toBe('done')
    const step = (t!.steps as { jobId: string; done: boolean }[])[0]
    expect(step.done).toBe(true)
    const job = await getDoc(`import_jobs/${step.jobId}`)
    expect(job!.createdBy).toBe('alexisricordi@gmail.com')
    expect(job!.place).toBe('Prop rack')
    expect((job!.counts as Record<string, number>).analyzed).toBe(3)
    await put('admin_tasks/t2', { kind: 'import', steps: [{ link: 'test:3' }], createdAt: 'x' })
    const t2 = await waitFor('admin_tasks/t2', d => d?.status === 'done' || d?.status === 'failed')
    expect((t2!.steps as { jobId: unknown }[])[0].jobId).toBe(null)
  })
})

describe('admin tasks: approve', () => {
  it('approves, merges and skips analysed photos as the owner', async () => {
    await put('admin_tasks/i1', { kind: 'import', steps: [{ link: 'test:4', place: 'Prop rack' }], createdAt: 'x' })
    const t = await waitFor('admin_tasks/i1', d => d?.status === 'done' || d?.status === 'failed')
    const jobId = (t!.steps as { jobId: string }[])[0].jobId
    const ids = ['test0001x4', 'test0002x4', 'test0003x4', 'test0004x4']
    await put('admin_tasks/a1', { kind: 'approve', createdAt: 'x',
      approvals: [{ id: ids[0], name: 'Fog machine', quantity: 2 }],
      merges: [{ ids: [ids[1], ids[2]], item: { name: 'Rotary phone', quantity: 1 } }], skips: [ids[3]] })
    const a = await waitFor('admin_tasks/a1', d => d?.status === 'done' || d?.status === 'failed')
    expect(a!.status).toBe('done')
    const one = await getDoc(`import_items/${ids[0]}`)
    expect(one!.status).toBe('approved')
    const item = await getDoc(`items/${one!.itemId}`)
    expect(item!.name).toBe('Fog machine')
    expect(item!.quantity).toBe(2)
    expect(item!.collection).toBe('company')
    const merged = await getDoc(`import_items/${ids[2]}`)
    expect((await getDoc(`items/${merged!.itemId}`))!.photos.length).toBe(2)
    expect((await getDoc(`import_items/${ids[3]}`))!.status).toBe('skipped')
    expect((await getDoc(`import_jobs/${jobId}`))!.counts.analyzed).toBe(0)
  })
})

describe('admin tasks: setBins', () => {
  it("moves props to the crew's bin by number, skips archived and unknown bins", async () => {
    await put('bins/b5', { label: 'B: 5', locationId: 'loc-main', qrSlug: 'b5' })
    await put('bins/b25', { label: 'B:25', locationId: 'loc-main', qrSlug: 'b25' })
    await put('items/p1', { name: 'Stapler', binId: 'b5', locationId: 'loc-main', collection: 'company' })
    await put('items/p2', { name: 'Old clock', binId: 'b5', archived: true, collection: 'company' })
    await put('admin_tasks/s1', { kind: 'setBins', createdAt: 'x', moves: [{ itemId: 'p1', bin: 'Bin 25' }, { itemId: 'p2', bin: 'Bin 25' }, { itemId: 'p1', bin: 'Bin 99' }] })
    const t = await waitFor('admin_tasks/s1', d => d?.status === 'done' || d?.status === 'failed')
    expect(t!.result.moved).toBe(1)
    expect(t!.result.skipped.length).toBe(2)
    expect((await getDoc('items/p1'))!.binId).toBe('b25')
    expect((await getDoc('items/p2'))!.binId).toBe('b5')
  })
})

describe('admin tasks: driveAudit (owner, Nov 17: "swords and hammers weren\'t imported")', () => {
  it('compares every Drive photo with the app: in the app, removed, waiting, never seen; finds props by words', async () => {
    // test:4 = four fake Drive photos test0001x4…test0004x4
    await put('items/p1', { name: 'Foam sword', collection: 'company', binId: 'b1', quantity: 2, photos: [] })
    await put('items/p2', { name: 'Claw hammer', collection: 'company', archived: true, removedAt: 'x', removedNote: 'Same prop twice', photos: [] })
    await put('import_items/test0001x4', { status: 'approved', itemId: 'p1', folder: 'Test folder' })
    await put('import_items/test0002x4', { status: 'approved', itemId: 'p2', folder: 'Test folder' })
    await put('import_items/test0003x4', { status: 'analyzed', folder: 'Test folder', suggestion: { name: 'Battle axe' } })
    await put('admin_tasks/a1', { kind: 'driveAudit', folder: 'test:4', words: ['sword', 'hammer'], createdAt: 'x' })
    const t = await waitFor('admin_tasks/a1', d => d?.status === 'done' || d?.status === 'failed')
    expect(t!.status, String(t!.error)).toBe('done')
    const res = t!.result as { total: number; counts: Record<string, number>; rows: { state: string; aiName: string | null }[]; matches: { name: string; bin: string | null; removed: string | null }[] }
    expect(res.total).toBe(4)
    expect(res.counts).toMatchObject({ 'in the app': 1, 'prop removed in clean-up': 1, 'analysed, waiting for someone to approve': 1, 'NEVER SEEN BY THE APP': 1 })
    expect(res.rows.find(r => r.state.startsWith('analysed'))!.aiName).toBe('Battle axe')
    expect(res.matches.map(m => m.name).sort()).toEqual(['Claw hammer', 'Foam sword'])
    expect(res.matches.find(m => m.name === 'Foam sword')!.bin).toBe('A1')
    expect(res.matches.find(m => m.name === 'Claw hammer')!.removed).toBe('Same prop twice')
  })
})

describe('admin tasks: schedule lists', () => {
  it('adds people by email or unique name, keeps existing ones and other settings, skips unclear names', async () => {
    await put('users/danny@example.com', { email: 'danny@example.com', name: 'Danny Lee', role: 'creator', active: true })
    await put('users/kyle@example.com', { email: 'kyle@example.com', name: 'Kyle', role: 'creator', active: true })
    await put('users/justin1@example.com', { email: 'justin1@example.com', name: 'Justin', role: 'creator', active: true })
    await put('users/justin2@example.com', { email: 'justin2@example.com', name: 'Justin F', role: 'creator', active: true })
    await put('app_settings/schedule', { noticeHours: 36, instantBookers: [{ email: 'jana@example.com', name: 'Jana' }] })
    await put('admin_tasks/l1', { kind: 'scheduleLists', instantBookers: ['Kyle', 'Justin'], longBookers: ['danny@example.com'], createdAt: 'x' })
    const t = await waitFor('admin_tasks/l1', d => d?.status === 'done' || d?.status === 'failed')
    expect(t!.status).toBe('done')
    const s = await getDoc('app_settings/schedule')
    expect(s!.noticeHours).toBe(36)
    expect((s!.instantBookers as { email: string }[]).map(p => p.email)).toEqual(['jana@example.com', 'kyle@example.com'])
    expect(s!.longBookers).toEqual([{ email: 'danny@example.com', name: 'Danny Lee' }])
    expect(String((t!.result as { notes: string[] }).notes)).toContain('"Justin" matches 2 people')
  })
})
