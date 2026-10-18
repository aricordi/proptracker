import { useRef } from 'react'

export interface PhotoSlot {
  key: string
  preview: string        // local preview or the saved URL
  url: string | null     // null while uploading
  progress: number | null
  failed?: boolean
}

interface Props {
  photos: PhotoSlot[]
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  onMakeCover: (key: string) => void
  max?: number
}

// Several photos per prop. The first photo is the cover shown in search.
export default function PhotoPicker({ photos, onAdd, onRemove, onMakeCover, max = 20 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const canAdd = photos.length < max

  if (photos.length === 0) {
    return (
      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-52 bg-pt-surface border-2 border-dashed border-pt-border rounded-2xl flex flex-col items-center justify-center gap-2 active:opacity-80"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-pt-muted">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
          </svg>
          <span className="text-pt-muted text-sm">Tap to add photos</span>
        </button>
        <FileInput inputRef={inputRef} onAdd={onAdd} />
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <div key={p.key} className="relative aspect-square rounded-xl overflow-hidden bg-pt-surface shadow-hairline">
            <img src={p.preview} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            {p.url === null && !p.failed && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                <div style={{ width: `${p.progress ?? 0}%` }} className="h-full bg-pt-accent transition-all duration-200" />
              </div>
            )}
            {p.failed && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-red-300 text-xs text-center px-1">
                Upload failed
              </div>
            )}
            {i === 0
              ? <span className="absolute top-1 left-1 bg-pt-accent text-stone-900 text-[10px] font-semibold px-2 py-0.5 rounded">Cover</span>
              : <button type="button" onClick={() => onMakeCover(p.key)}
                  className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded active:opacity-70">
                  Make cover
                </button>
            }
            <button type="button" aria-label="Remove photo" onClick={() => onRemove(p.key)}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none flex items-center justify-center active:opacity-70">
              ×
            </button>
          </div>
        ))}
        {canAdd && (
          <button type="button" onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-xl border-2 border-dashed border-pt-border text-pt-muted text-sm flex flex-col items-center justify-center active:opacity-70">
            <span className="text-2xl leading-none">+</span>
            Add
          </button>
        )}
      </div>
      <FileInput inputRef={inputRef} onAdd={onAdd} />
    </div>
  )
}

function FileInput({ inputRef, onAdd }: { inputRef: React.RefObject<HTMLInputElement>; onAdd: (f: File[]) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={e => {
        const files = Array.from(e.target.files ?? [])
        if (files.length) onAdd(files)
        e.target.value = ''
      }}
    />
  )
}
