// Me → the laptop layout switch (only shown on a laptop-size screen to the owner, the equipment team and admins).
import { useDesk, setDeskOff } from './desk'

export function LaptopLayoutCard() {
  const desk = useDesk()
  if (!desk.can) return null
  return (
    <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-pt-text font-semibold">Laptop layout</p>
        <p className="text-pt-muted text-sm">{desk.on ? 'Sidebar, wide week board and analytics on this computer.' : 'Off: this computer shows the phone layout.'}</p>
      </div>
      <button onClick={() => setDeskOff(desk.on)} className={`px-4 min-h-[40px] rounded-xl font-semibold ${desk.on ? 'bg-pt-raised text-pt-text' : 'bg-pt-accent text-stone-900'}`}>
        {desk.on ? 'Use phone layout' : 'Turn it on'}</button>
    </div>
  )
}
