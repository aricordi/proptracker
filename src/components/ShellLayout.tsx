import { Suspense, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useSession } from '../auth'
import { DeskSidebar, useDesk, FULL_WIDTH, FULL_EXACT } from '../desk/desk'

function Page() {
  return (
    <Suspense fallback={<div className="min-h-full bg-pt-bg" />}>
      <Outlet />
    </Suspense>
  )
}

// The laptop frame (owner, equipment, admin on a wide screen): sidebar on the left; pages built for it use the full width,
// every other page sits phone-width in the middle (`desk-narrow` keeps their fixed bottom bars inside that column).
function DeskFrame({ full, children }: { full: boolean; children: ReactNode }) {
  return (
    <div className={`flex h-full bg-pt-bg desk-shell ${full ? '' : 'desk-narrow'}`}>
      <DeskSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {full ? children : <div className="max-w-[760px] mx-auto min-h-full">{children}</div>}
      </main>
    </div>
  )
}

export default function ShellLayout() {
  const desk = useDesk()
  const { role } = useSession()
  const path = useLocation().pathname
  if (desk.on) {
    const full = FULL_WIDTH.some(p => path === p || path.startsWith(p + '/')) || FULL_EXACT.includes(path) || (path === '/' && role === 'admin')
    return <DeskFrame full={full}><Page /></DeskFrame>
  }
  return (
    <div className="flex flex-col h-full bg-pt-bg">
      <main className="flex-1 overflow-y-auto">
        {/* The tab bar stays put while a screen's code loads. (No animated wrapper here: it would
            trap pop-up sheets underneath the tab bar.) */}
        <Page />
      </main>
      <BottomNav />
    </div>
  )
}

// Detail pages (a prop, a request, a gear booking, the team guide…): full screen with no tab bar on phones, but on the
// laptop they keep the sidebar and sit in the same narrow column as every other page (design pass, Nov 23: they used to
// stretch across 1440 px with no way back but the browser).
export function DetailLayout() {
  const desk = useDesk()
  if (desk.on) return <DeskFrame full={false}><Page /></DeskFrame>
  return <Page />
}
