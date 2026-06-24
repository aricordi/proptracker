import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function ShellLayout() {
  return (
    <div className="flex flex-col h-full bg-pt-bg">
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
