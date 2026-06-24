import { useRef } from 'react'

interface Props {
  previewUrl: string | null
  uploadProgress: number | null
  onFileSelected: (file: File) => void
}

export default function PhotoPicker({ previewUrl, uploadProgress, onFileSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative w-full h-52 bg-pt-surface border-2 border-dashed border-pt-border rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-2 active:opacity-80"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-pt-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
            </svg>
            <span className="text-pt-muted text-sm">Tap to add photo</span>
          </>
        )}

        {previewUrl && (
          <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
            Change
          </span>
        )}
      </button>

      {uploadProgress !== null && uploadProgress < 100 && (
        <div className="mt-2 h-1 bg-pt-border rounded-full overflow-hidden">
          <div
            style={{ width: `${uploadProgress}%` }}
            className="h-full bg-pt-accent rounded-full transition-all duration-200"
          />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onFileSelected(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
