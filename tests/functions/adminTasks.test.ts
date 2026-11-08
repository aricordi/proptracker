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
