// The gear being put together for a shoot: day, hours, bundles and extras.
// Kept on this phone only (survives closing the app) until it's held.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface GearCart {
  date: string | null
  start: number          // minutes after midnight
  end: number
  lines: Record<string, number>   // offerId → how many (bundles are always 1)
}

interface GearCartApi extends GearCart {
  setWhen: (date: string | null, start: number, end: number) => void
  setQty: (offerId: string, qty: number) => void   // 0 removes
  clear: () => void
  count: number
}

const EMPTY: GearCart = { date: null, start: 10 * 60, end: 18 * 60, lines: {} }
const KEY = 'primecapitol.gearcart.v1'

function load(): GearCart {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch { return EMPTY }
}

const Ctx = createContext<GearCartApi | null>(null)

export function GearCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<GearCart>(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(cart)) } catch { /* private mode: fine */ }
  }, [cart])
  const api: GearCartApi = {
    ...cart,
    count: Object.values(cart.lines).filter(n => n > 0).length,
    setWhen: (date, start, end) => setCart(c => ({ ...c, date, start, end: Math.max(end, start + 30) })),
    setQty: (offerId, qty) => setCart(c => {
      const lines = { ...c.lines }
      if (qty > 0) lines[offerId] = qty
      else delete lines[offerId]
      return { ...c, lines }
    }),
    clear: () => setCart(c => ({ ...EMPTY, date: c.date, start: c.start, end: c.end })),
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useGearCart(): GearCartApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useGearCart outside GearCartProvider')
  return c
}
