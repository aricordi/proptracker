import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocations } from '../hooks/useLocations'
import { addLocation, updateLocation, deleteLocation, canDeleteLocation } from '../services/locations'
import BottomSheet from '../components/BottomSheet'
import type { Location } from '../types'

type SheetMode = { mode: 'add' } | { mode: 'edit'; loc: Location }

export default function LocationsScreen() {
  const navigate  = useNavigate()
  const locations = useLocations()

  const [sheet, setSheet] = useState<SheetMode | null>(null)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openAdd() {
    setName('')
    setNotes('')
    setError(null)
    setSheet({ mode: 'add' })
  }

  function openEdit(loc: Location) {
    setName(loc.name)
    setNotes(loc.notes ?? '')
    setError(null)
    setSheet({ mode: 'edit', loc })
  }

  function closeSheet() {
    setSheet(null)
    setError(null)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      if (sheet?.mode === 'edit') {
        await updateLocation(sheet.loc.id, {
          name: trimmed,
          ...(notes.trim() ? { notes: notes.trim() } : { notes: undefined }),
        })
      } else {
        await addLocation({
          name: trimmed,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        })
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
      const check = await canDeleteLocation(sheet.loc.id)
      if (!check.canDelete) {
        const parts: string[] = []
        if (check.itemCount > 0) parts.push(`${check.itemCount} item${check.itemCount !== 1 ? 's' : ''}`)
        if (check.binCount > 0) parts.push(`${check.binCount} bin${check.binCount !== 1 ? 's' : ''}`)
        setError(`Can't delete — this location has ${parts.join(' and ')}. Reassign them first, then delete.`)
        return
      }
      await deleteLocation(sheet.loc.id)
      closeSheet()
    } catch {
      setError('Delete failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-pt-bg">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-pt-muted text-sm active:text-pt-text py-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="font-display text-xl text-pt-accent py-2">Locations</h1>
        <button
          onClick={openAdd}
          className="bg-pt-accent text-stone-900 px-4 py-2 rounded-xl font-semibold text-sm active:opacity-80"
        >
          + Add
        </button>
      </div>
      <div className="p-4">

      {locations.length === 0 ? (
        <p className="text-pt-muted text-sm text-center mt-16 leading-relaxed">
          No locations yet.<br />Add places like "Shed", "Office", or "Camera Bag".
        </p>
      ) : (
        <div className="space-y-2">
          {locations.map(loc => (
            <button
              key={loc.id}
              onClick={() => openEdit(loc)}
              className="w-full text-left bg-pt-surface border border-pt-border rounded-2xl p-4 active:opacity-75 transition-opacity"
            >
              <div className="font-medium text-pt-text">{loc.name}</div>
              {loc.notes && (
                <div className="text-pt-muted text-sm mt-0.5 truncate">{loc.notes}</div>
              )}
            </button>
          ))}
        </div>
      )}

      <BottomSheet
        open={sheet !== null}
        onClose={closeSheet}
        title={sheet?.mode === 'add' ? 'Add Location' : 'Edit Location'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-pt-muted text-xs uppercase tracking-wider mb-1.5">
              Name *
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Shed, Office, Camera Bag"
              autoFocus
              className="w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
            />
          </div>

          <div>
            <label className="block text-pt-muted text-xs uppercase tracking-wider mb-1.5">
              Notes (optional)
            </label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Temperature-sensitive items"
              className="w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
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
              Delete location
            </button>
          )}
        </div>
      </BottomSheet>
      </div>
    </div>
  )
}
