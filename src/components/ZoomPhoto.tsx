// A small photo that opens full size when tapped (arts team, Nov 15: "when I press on the photo on the request it doesn't
// make the image larger"). It's a span with role="button" so it can sit inside a row that is itself a button: the tap
// opens the photo and doesn't also open the row.
import { useState } from 'react'
import ImageLightbox from './ImageLightbox'

export default function ZoomPhoto({ src, title, item, className = 'w-full h-full object-cover' }: {
  src: string; title?: string; className?: string
  item?: { name: string; binId?: string | null; locationId?: string | null }
}) {
  const [open, setOpen] = useState(false)
  const show = (e: { stopPropagation: () => void; preventDefault: () => void }) => { e.stopPropagation(); e.preventDefault(); setOpen(true) }
  return (
    <>
      <span role="button" tabIndex={0} aria-label={`See the photo of ${title ?? item?.name ?? 'this prop'} larger`}
        onClick={show} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') show(e) }}
        className="block w-full h-full cursor-zoom-in">
        <img loading="lazy" decoding="async" src={src} alt="" className={className} />
      </span>
      {open && <ImageLightbox src={src} alt={title ?? item?.name ?? ''} title={title} item={item} onClose={() => setOpen(false)} />}
    </>
  )
}
