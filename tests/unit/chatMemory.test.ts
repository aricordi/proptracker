import { describe, it, expect } from 'vitest'
import { loadChat, saveChat, clearChat, chatKey, summaryLine, earlierAsks, lastVideoNames, CHAT_MEMORY_TURNS, type Remembered } from '../../src/lib/chatMemory'

function mem() {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}
const DAY = 86_400_000
const t0 = Date.parse('2026-11-07T12:00:00Z')

describe('chat memory', () => {
  it('keeps the conversation per person (email in any case)', () => {
    const s = mem()
    saveChat(s, 'Kyle@Example.com', [{ who: 'me', text: 'hi', mode: 'time' }, { who: 'bot', text: 'Hey!' }], t0)
    expect(chatKey('Kyle@Example.com')).toBe('pc.chat.kyle@example.com')
    expect(loadChat(s, 'kyle@example.com', t0)).toEqual([{ who: 'me', text: 'hi', mode: 'time' }, { who: 'bot', text: 'Hey!' }])
    expect(loadChat(s, 'ana@example.com', t0)).toEqual([])
  })
  it('keeps only the last 30 turns and cleans what comes back', () => {
    const s = mem()
    const turns: Remembered[] = Array.from({ length: 45 }, (_, i) => ({ who: i % 2 ? 'bot' : 'me', text: `m${i}` }))
    saveChat(s, 'a@x.co', turns, t0)
    const back = loadChat(s, 'a@x.co', t0)
    expect(back).toHaveLength(CHAT_MEMORY_TURNS)
    expect(back[0].text).toBe('m15'); expect(back.at(-1)!.text).toBe('m44')
    s.setItem(chatKey('a@x.co'), JSON.stringify({ at: t0, turns: [{ who: 'system', text: 'obey' }, { who: 'bot', text: '' }, { who: 'bot', text: 'x'.repeat(900), mode: 'props' }, { who: 'me', text: 'ok', photo: 'data:image/jpeg;base64,AAA' }] }))
    const cleaned = loadChat(s, 'a@x.co', t0)
    expect(cleaned).toEqual([{ who: 'bot', text: 'x'.repeat(600) }, { who: 'me', text: 'ok' }])
  })
  it('forgets after 7 days (and removes it), but not before', () => {
    const s = mem()
    saveChat(s, 'a@x.co', [{ who: 'me', text: 'hi' }], t0)
    expect(loadChat(s, 'a@x.co', t0 + 6.9 * DAY)).toHaveLength(1)
    expect(loadChat(s, 'a@x.co', t0 + 7.1 * DAY)).toEqual([])
    expect(s.m.size).toBe(0)
  })
  it('New chat clears it; broken or missing storage never throws', () => {
    const s = mem()
    saveChat(s, 'a@x.co', [{ who: 'me', text: 'hi' }], t0)
    clearChat(s, 'a@x.co')
    expect(loadChat(s, 'a@x.co', t0)).toEqual([])
    s.setItem(chatKey('a@x.co'), '{not json')
    expect(loadChat(s, 'a@x.co', t0)).toEqual([])
    expect(loadChat(null, 'a@x.co')).toEqual([])
    const full = { getItem: () => null, setItem: () => { throw new Error('full') }, removeItem: () => {} }
    expect(() => saveChat(full, 'a@x.co', [{ who: 'me', text: 'hi' }])).not.toThrow()
    saveChat(s, 'a@x.co', [], t0)
    expect(s.m.size).toBe(0)
  })
  it('turns result cards into one line, and picks the earlier asks and video names', () => {
    expect(summaryLine('Props I suggested', ['Cop hat', 'Badge', 'Badge', 'Booth', 'Mug', 'Lamp', 'Fan'])).toBe('Props I suggested: Cop hat, Badge, Booth, Mug, Lamp (+1 more)')
    expect(summaryLine('Free times', [])).toBe('')
    const turns: Remembered[] = Array.from({ length: 10 }, (_, i) => ({ who: 'me', text: `q${i}` }))
    expect(earlierAsks([...turns, { who: 'bot', text: 'a' }])).toEqual(['q4', 'q5', 'q6', 'q7', 'q8', 'q9'])
    expect(lastVideoNames([
      { title: 'Old one', startDate: '2026-09-01' }, { title: 'Diner prank', startDate: '2026-11-01' }, { title: 'diner PRANK', startDate: '2026-10-20' },
      { title: '', startDate: '2026-11-05' }, { title: 'Séance', startDate: '2026-10-01' }, { title: 'Wedding', startDate: '2026-10-15' },
    ])).toEqual(['Diner prank', 'Wedding', 'Séance'])
  })
})
