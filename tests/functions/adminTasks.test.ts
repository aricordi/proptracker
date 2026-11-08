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
