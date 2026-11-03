import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useSession } from '../auth'
import { DeskSidebar, useDesk, FULL_WIDTH, FULL_EXACT } from '../desk/desk'

export default function ShellLayout() {
  const desk = useDesk()
  const { role } = useSession()
  const path = useLocation().pathname
  const page = (
    <Suspense fallback={<div className="min-h-full bg-pt-bg" />}>
      <Outlet />
    </Suspense>
  )
  // Laptop (owner, equipment, admin on a wide screen): sidebar on the left; pages built for it use the full width,
  // every other page sits phone-width in the middle.
  if (desk.on) {
    const full = FULL_WIDTH.some(p => path === p || path.startsWith(p + '/')) || FULL_EXACT.includes(path) || (path === '/' && role === 'admin')
    return (
      <div className="flex h-full bg-pt-bg">
        <DeskSidebar />
        <main className="flex-1 min-w-0 overflow-y-auto">
          {full ? page : <div className="max-w-[760px] mx-auto min-h-full">{page}</div>}
        </main>
      </div>
    )
  }
  return (
    <div className="flex flex-col h-full bg-pt-bg">
      <main className="flex-1 overflow-y-auto">
        {/* The tab bar stays put while a screen's code loads. (No animated wrapper here: it would
            trap pop-up sheets underneath the tab bar.) */}
        {page}
      </main>
      <BottomNav />
    </div>
  )
}
