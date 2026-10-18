import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function ShellLayout() {
  return (
    <div className="flex flex-col h-full bg-pt-bg">
      <main className="flex-1 overflow-y-auto">
        {/* The tab bar stays put while a screen's code loads. (No animated wrapper here: it would
            trap pop-up sheets underneath the tab bar.) */}
        <Suspense fallback={<div className="min-h-full bg-pt-bg" />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  )
}
