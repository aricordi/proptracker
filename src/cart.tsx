// The reservation being put together: shoot dates + props + quantities.
// Kept on this phone only (survives closing the app) until it's submitted.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface Cart {
  start: string | null
  end: string | null
  lines: Record<string, number>   // itemId → quantity
  builds: CartBuild[]             // things the arts department needs to make or find
}

export interface CartBuild { key: string; description: string; qty: number; refPhoto?: string }

interface CartApi extends Cart {
  setDates: (start: string | null, end: string | null) => void
  setQty: (itemId: string, qty: number) => void   // 0 removes
  addBuild: (b: Omit<CartBuild, 'key'>) => void
  removeBuild: (key: string) => void
  clear: () => void
  count: number
}

const EMPTY: Cart = { start: null, end: null, lines: {}, builds: [] }
const KEY = 'proptracker.cart.v1'

function load(): Cart {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch { return EMPTY }
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(cart)) } catch { /* private mode: fine */ }
  }, [cart])

  const api: CartApi = {
    ...cart,
    count: Object.keys(cart.lines).length + cart.builds.length,
    setDates: (start, end) => setCart(c => ({ ...c, start, end: end && start && end < start ? start : end })),
    setQty: (itemId, qty) => setCart(c => {
      const lines = { ...c.lines }
      if (qty > 0) lines[itemId] = qty
      else delete lines[itemId]
      return { ...c, lines }
    }),
    addBuild: b => setCart(c => ({ ...c, builds: [...c.builds, { ...b, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }] })),
    removeBuild: key => setCart(c => ({ ...c, builds: c.builds.filter(b => b.key !== key) })),
    clear: () => setCart(EMPTY),
  }
  return <CartContext.Provider value={api}>{children}</CartContext.Provider>
}

export function useCart(): CartApi {
  const c = useContext(CartContext)
  if (!c) throw new Error('useCart outside CartProvider')
  return c
}
