import { useRef, useState } from 'react'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'

interface Slot { key: string; preview: string; url: string | null; failed?: boolean }

interface Props {
  folder: string                         // e.g. reservation-photos/{id}/pack
  urls: string[]
  onChange: (urls: string[]) => void
  onUploading?: (busy: boolean) => void
  label: string
  hint?: string
  max?: number
}

// Take or pick photos as proof; each uploads straight away. Opens the camera on phones.
export default function ProofPhotos({ folder, urls, onChange, onUploading, label, hint, max = 10 }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const latest = useRef(urls)
  latest.current = urls

  function add(files: File[]) {
    for (const file of files.slice(0, max - slots.length)) {
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      setSlots(s => [...s, { key, preview: URL.createObjectURL(file), url: null }])
      onUploading?.(true)
      const task = uploadBytesResumable(storageRef(storage, `${folder}/${key}.jpg`), file, { contentType: file.type || 'image/jpeg' })
      task.on('state_changed', undefined,
        () => {
          setSlots(s => s.map(x => x.key === key ? { ...x, failed: true } : x))
          onUploading?.(false)
        },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref)
          setSlots(s => s.map(x => x.key === key ? { ...x, url } : x))
          onChange([...latest.current, url])
          onUploading?.(false)
        })
    }
  }

  function remove(slot: Slot) {
    // The file stays in storage (proof is never deleted); it's just not attached.
    setSlots(s => s.filter(x => x.key !== slot.key))
    if (slot.url) onChange(latest.current.filter(u => u !== slot.url))
  }

  return (
    <div className="space-y-2">
      <p className="text-pt-text text-sm font-medium">{label}</p>
      {hint && <p className="text-pt-muted text-xs">{hint}</p>}
      <div className="grid grid-cols-3 gap-2">
        {slots.map(s => (
          <div key={s.key} className="relative aspect-square rounded-xl overflow-hidden bg-pt-border">
            <img src={s.preview} alt="" className="w-full h-full object-cover" />
            {!s.url && !s.failed && <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-xs">Uploading…</div>}
            {s.failed && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-red-300 text-xs">Failed</div>}
            <button onClick={() => remove(s)} aria-label="Remove photo"
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-sm">×</button>
          </div>
        ))}
        {slots.length < max && (
          <button onClick={() => input.current?.click()}
            className="aspect-square rounded-xl border-2 border-dashed border-pt-accent/60 text-pt-accent text-sm flex flex-col items-center justify-center gap-1 active:opacity-70">
            <span className="text-2xl leading-none">📷</span>
            {slots.length ? 'Add' : 'Take photo'}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    </div>
  )
}

// Read-only strip of proof photos; tap to open full size.
export function PhotoStrip({ urls, title }: { urls?: string[]; title: string }) {
  if (!urls?.length) return null
  return (
    <div>
      <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">{title}</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {urls.map(u => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="w-24 h-24 rounded-xl overflow-hidden bg-pt-border shrink-0">
            <img src={u} alt="" className="w-full h-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  )
}
