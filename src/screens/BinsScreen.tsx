import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useBins } from '../hooks/useBins'
import { useLocations } from '../hooks/useLocations'
import { addBin, updateBin, deleteBin, canDeleteBin } from '../services/bins'
import BottomSheet from '../components/BottomSheet'
import type { Bin, Location } from '../types'

type SheetMode = { mode: 'add' } | { mode: 'edit'; bin: Bin }

export default function BinsScreen() {
  const navigate = useNavigate()
  const bins = useBins()
  const locations = useLocations()

  const [sheet, setSheet] = useState<SheetMode | null>(null)
  const [qrBin, setQrBin] = useState<Bin | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const [label, setLabel] = useState('')
  const [locationId, setLocationId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Group bins by location for display
  const grouped = useMemo(() => {
    const map: Record<string, Bin[]> = {}
    for (const bin of bins) {
      const key = bin.locationId || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(bin)
    }
    return map
  }, [bins])

  const locationMap = useMemo(() =>
    Object.fromEntries(locations.map(l => [l.id, l])),
  [locations])

  function openAdd() {
    setLabel('')
    setLocationId(locations[0]?.id ?? '')
    setError(null)
    setSheet({ mode: 'add' })
  }

  function openEdit(bin: Bin) {
    setLabel(bin.label)
    setLocationId(bin.locationId)
    setError(null)
    setSheet({ mode: 'edit', bin })
  }

  function closeSheet() {
    setSheet(null)
    setError(null)
  }

  async function openQr(bin: Bin) {
    setQrBin(bin)
    setQrDataUrl(null)
    const url = `${window.location.origin}/bin/${bin.qrSlug}`
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2 })
      setQrDataUrl(dataUrl)
    } catch {
      setQrDataUrl(null)
    }
  }

  async function handlePrint(bin: Bin) {
    const url = `${window.location.origin}/bin/${bin.qrSlug}`
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 })
      const win = window.open('', '_blank', 'width=600,height=700')
      if (!win) return
      win.document.write(`<!DOCTYPE html>
        <html><head>
          <title>QR – ${bin.label}</title>
          <style>
            body{display:flex;flex-direction:column;align-items:center;justify-content:center;
                 min-height:100vh;margin:0;font-family:sans-serif;}
            h2{margin-bottom:20px;font-size:24px;}
            img{max-width:300px;display:block;}
            p{margin-top:12px;font-size:11px;color:#666;word-break:break-all;text-align:center;max-width:300px;}
          </style>
        </head><body>
          <h2>${bin.label}</h2>
          <img src="${dataUrl}" alt="QR Code"/>
          <p>${url}</p>
          <script>window.onload=()=>window.print()<\/script>
        </body></html>`)
      win.document.close()
    } catch {
      // fall through silently
    }
  }

  async function handleSave() {
    const trimmed = label.trim()
    if (!trimmed || !locationId) return
    setSaving(true)
    setError(null)
    try {
      if (sheet?.mode === 'edit') {
        await updateBin(sheet.bin.id, { label: trimmed, locationId })
      } else {
        await addBin({ label: trimmed, locationId })
      }
      closeSheet()
    } catch {
      setError('Save failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (sheet?.mode !== 'edit') return
    setSaving(true)
    setError(null)
    try {
      const check = await canDeleteBin(sheet.bin.id)
      if (!check.canDelete) {
        setError(`Can't delete — this bin has ${check.itemCount} item${check.itemCount !== 1 ? 's' : ''}. Reassign them first.`)
        return
      }
      await deleteBin(sheet.bin.id)
      closeSheet()
    } catch {
      setError('Delete failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // Ordered location groups: locations in order, then unassigned
  const orderedGroups: Array<{ location: Location | null; bins: Bin[] }> = [
    ...locations
      .filter(l => grouped[l.id]?.length)
      .map(l => ({ location: l, bins: grouped[l.id] })),
    ...(grouped['__none__']?.length
      ? [{ location: null, bins: grouped['__none__'] }]
      : []),
  ]

  return (
    <div className="p-4 pt-safe">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-display text-2xl text-pt-text">Bins</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/locations')}
            className="text-pt-muted text-sm px-3 py-2 rounded-xl border border-pt-border active:opacity-70"
          >
            Locations
          </button>
          <button
            onClick={openAdd}
            disabled={locations.length === 0}
            className="bg-pt-accent text-stone-900 px-4 py-2 rounded-xl font-semibold text-sm active:opacity-80 disabled:opacity-40"
          >
            + Add
          </button>
        </div>
      </div>

      {locations.length === 0 && (
        <div className="text-center mt-16 space-y-3">
          <p className="text-pt-muted text-sm leading-relaxed">
            You need at least one location before you can add bins.
          </p>
          <button
            onClick={() => navigate('/locations')}
            className="bg-pt-accent text-stone-900 px-5 py-2.5 rounded-xl font-semibold text-sm active:opacity-80"
          >
            Add a Location
          </button>
        </div>
      )}

      {locations.length > 0 && bins.length === 0 && (
        <p className="text-pt-muted text-sm text-center mt-16 leading-relaxed">
          No bins yet. Tap "+ Add" to create your first bin.
        </p>
      )}

      <div className="space-y-6">
        {orderedGroups.map(({ location, bins: groupBins }) => (
          <div key={location?.id ?? '__none__'}>
            <h2 className="text-pt-muted text-xs uppercase tracking-wider mb-2 px-1">
              {location?.name ?? 'No location'}
            </h2>
            <div className="space-y-2">
              {groupBins.map(bin => (
                <div
                  key={bin.id}
                  className="flex items-center bg-pt-surface border border-pt-border rounded-2xl overflow-hidden"
                >
                  <button
                    onClick={() => openEdit(bin)}
                    className="flex-1 text-left px-4 py-4 active:opacity-75"
                  >
                    <span className="font-medium text-pt-text">{bin.label}</span>
                  </button>
                  <button
                    onClick={() => openQr(bin)}
                    className="px-4 py-4 text-pt-muted active:text-pt-accent"
                    aria-label="Show QR code"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <path d="M14 14h2v2h-2zM18 14h3v3h-3zM14 18h3v3h-3zM18 19h3" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Add sheet */}
      <BottomSheet
        open={sheet !== null}
        onClose={closeSheet}
        title={sheet?.mode === 'add' ? 'Add Bin' : 'Edit Bin'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-pt-muted text-xs uppercase tracking-wider mb-1.5">
              Label *
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Bin 1, Costumes Box, Camera Bag"
              autoFocus
              className="w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
            />
          </div>

          <div>
            <label className="block text-pt-muted text-xs uppercase tracking-wider mb-1.5">
              Location *
            </label>
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              className="w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text focus:outline-none focus:border-pt-accent"
            >
              {locations.map((l: Location) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={!label.trim() || !locationId || saving}
            className="w-full bg-pt-accent text-stone-900 py-3.5 rounded-xl font-semibold disabled:opacity-40 active:opacity-80"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {sheet?.mode === 'edit' && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="w-full text-red-400 py-3 rounded-xl font-medium text-sm active:opacity-70 disabled:opacity-40"
            >
              Delete bin
            </button>
          )}
        </div>
      </BottomSheet>

      {/* QR Code sheet */}
      <BottomSheet
        open={qrBin !== null}
        onClose={() => setQrBin(null)}
        title={qrBin ? `QR — ${qrBin.label}` : ''}
      >
        {qrBin && (
          <div className="flex flex-col items-center gap-5">
            <div className="text-pt-muted text-xs text-center">
              {locationMap[qrBin.locationId]?.name ?? ''}
            </div>

            <div className="bg-white p-3 rounded-2xl">
              {qrDataUrl
                ? <img src={qrDataUrl} alt="QR Code" className="w-56 h-56" />
                : <div className="w-56 h-56 flex items-center justify-center text-gray-400 text-sm">Generating…</div>
              }
            </div>

            <p className="text-pt-muted text-xs text-center break-all px-2">
              {window.location.origin}/bin/{qrBin.qrSlug}
            </p>

            <button
              onClick={() => handlePrint(qrBin)}
              className="w-full bg-pt-accent text-stone-900 py-3.5 rounded-xl font-semibold active:opacity-80"
            >
              Print QR code
            </button>

            <p className="text-pt-muted text-xs text-center">
              Stick the printout on the physical bin. When scanned, it opens the app directly to this bin.
            </p>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
