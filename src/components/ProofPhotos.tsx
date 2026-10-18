import { useEffect, useRef, useState } from 'react'
import { ref as storageRef, uploadBytesResumable, getDownloadURL, getMetadata } from 'firebase/storage'
import { storage } from '../firebase'
import { shrinkPhoto } from '../lib/shrinkPhoto'
import { photoTakenAt, photoAge } from '../lib/photoTakenAt'

interface Slot { key: string; preview: string; url: string | null; failed?: boolean; why?: string; takenAt?: string | null }

interface Props {
  folder: string                         // e.g. reservation-photos/{id}/pack
  urls: string[]
  onChange: (urls: string[]) => void
  onUploading?: (busy: boolean) => void
  label: string
  hint?: string
  max?: number
  cameraOnly?: boolean   // proof photos: the camera opens directly, no gallery (owner decision Oct 14)
}

// Take or pick photos as proof; each uploads straight away. Opens the camera on phones.
export default function ProofPhotos({ folder, urls, onChange, onUploading, label, hint, max = 10, cameraOnly = true }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const latest = useRef(urls)
  latest.current = urls

  function add(files: File[]) {
    for (const file of files.slice(0, max - slots.length)) {
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      setSlots(s => [...s, { key, preview: URL.createObjectURL(file), url: null }])
      onUploading?.(true)
      // Read when it was taken first: shrinking drops that information.
      void photoTakenAt(file).then(async takenAt => {
      setSlots(s => s.map(x => x.key === key ? { ...x, takenAt } : x))
      const blob = await shrinkPhoto(file)
      const type = blob === file ? (file.type || 'image/jpeg') : 'image/jpeg'
      const task = uploadBytesResumable(storageRef(storage, `${folder}/${key}.jpg`), blob, {
        contentType: type,
        customMetadata: { takenAt: takenAt ?? '', source: cameraOnly ? 'camera' : 'any' },
      })
      task.on('state_changed', undefined,
        (err: { code?: string }) => {
          console.error('Photo upload failed', err)
          const why = err?.code === 'storage/unauthorized' ? 'Not allowed' : err?.code === 'storage/retry-limit-exceeded' ? 'No signal' : 'Failed'
          setSlots(s => s.map(x => x.key === key ? { ...x, failed: true, why } : x))
          onUploading?.(false)
        },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref)
          setSlots(s => s.map(x => x.key === key ? { ...x, url } : x))
          onChange([...latest.current, url])
          onUploading?.(false)
        })
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
            {s.failed && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-red-300 text-xs text-center px-1">{s.why ?? 'Failed'}<br />Remove and try again</div>}
            {s.takenAt !== undefined && <StampBadge stamp={photoAge(s.takenAt, new Date().toISOString())} />}
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
      {cameraOnly && <p className="text-pt-muted text-xs">Opens your camera: take the photo now, on the spot.</p>}
      <input ref={input} type="file" accept="image/*" {...(cameraOnly ? { capture: 'environment' as const } : { multiple: true })} className="hidden"
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
        {urls.map(u => <StripPhoto key={u} url={u} />)}
      </div>
    </div>
  )
}

// One saved proof photo. Proof photos are cleaned up after about 6 months (owner, Oct 17), so a missing
// one says so instead of showing a broken image.
function StripPhoto({ url }: { url: string }) {
  const [gone, setGone] = useState(false)
  if (gone) return <div className="w-24 h-24 shrink-0 rounded-xl bg-pt-border grid place-items-center text-center text-pt-muted text-[11px] px-2 leading-tight">Photo removed after 6 months</div>
  return (
    <div className="w-24 shrink-0 space-y-1">
      <a href={url} target="_blank" rel="noreferrer" className="block w-24 h-24 rounded-xl overflow-hidden bg-pt-border">
        <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover" onError={() => setGone(true)} />
      </a>
      <PhotoStamp url={url} />
    </div>
  )
}

type Stamp = ReturnType<typeof photoAge>
const STAMP_STYLE: Record<Stamp['tone'], string> = { ok: 'text-pt-muted', warn: 'text-amber-300', bad: 'text-red-300 font-semibold' }

function StampBadge({ stamp }: { stamp: Stamp }) {
  return (
    <span className={`absolute bottom-0 inset-x-0 bg-black/70 px-1 py-0.5 text-[10px] leading-tight ${STAMP_STYLE[stamp.tone]}`}>
      {stamp.tone === 'ok' ? '' : '⚠ '}{stamp.text}
    </span>
  )
}

// Under a saved proof photo: when it was taken vs when it reached us (the server's upload
// time, which the phone can't change). Photos from before Oct 14 have no record: nothing shown.
export function PhotoStamp({ url }: { url: string }) {
  const [stamp, setStamp] = useState<Stamp | null>(null)
  useEffect(() => {
    let on = true
    getMetadata(storageRef(storage, url)).then(m => {
      if (!on || m.customMetadata?.takenAt === undefined) return
      setStamp(photoAge(m.customMetadata.takenAt || null, m.timeCreated))
    }).catch(() => {})
    return () => { on = false }
  }, [url])
  if (!stamp) return null
  return <p className={`text-[10px] leading-tight ${STAMP_STYLE[stamp.tone]}`}>{stamp.tone === 'ok' ? '' : '⚠ '}{stamp.text}</p>
}
