import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { getDocs, collection } from 'firebase/firestore'
import { auth, storage, db } from '../firebase'
import { addItem } from '../services/items'
import { getOrCreateTag, incrementTagUsage } from '../services/tags'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useTags } from '../hooks/useTags'
import PhotoPicker from '../components/PhotoPicker'
import TagInput from '../components/TagInput'
import type { ItemType } from '../types'

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: 'prop', label: 'Prop' },
  { value: 'costume', label: 'Costume' },
  { value: 'set-dressing', label: 'Set Dressing' },
  { value: 'gear', label: 'Gear' },
]

export default function AddItemScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const locations = useLocations()
  const bins = useBins()
  const tags = useTags()

  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('prop')
  const [locationId, setLocationId] = useState(searchParams.get('locationId') ?? '')
  const [binId, setBinId] = useState(searchParams.get('binId') ?? '')
  const [tagLabels, setTagLabels] = useState<string[]>([])
  const [character, setCharacter] = useState('')
  const [showCharSuggestions, setShowCharSuggestions] = useState(false)
  const [characterOptions, setCharacterOptions] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [whereToRebuy, setWhereToRebuy] = useState('')
  const [showMore, setShowMore] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load unique character values from existing items for autocomplete
  useEffect(() => {
    getDocs(collection(db, 'items')).then(snap => {
      const chars = new Set<string>()
      snap.docs.forEach(d => {
        const c = d.data().character as string | undefined
        if (c) chars.add(c)
      })
      setCharacterOptions(Array.from(chars).sort())
    }).catch(() => {})
  }, [])

  const filteredBins = bins.filter(b => b.locationId === locationId)

  function handleFileSelected(file: File) {
    const preview = URL.createObjectURL(file)
    setPhotoPreview(preview)
    setPhotoUrl(null)
    setUploadProgress(0)

    const uid = auth.currentUser?.uid ?? 'unknown'
    const fileRef = storageRef(storage, `items/${uid}/${Date.now()}_${file.name}`)
    const task = uploadBytesResumable(fileRef, file)

    task.on(
      'state_changed',
      snap => setUploadProgress((snap.bytesTransferred / snap.totalBytes) * 100),
      () => { setUploadProgress(null) },
      () => getDownloadURL(task.snapshot.ref).then(url => {
        setPhotoUrl(url)
        setUploadProgress(null)
      }),
    )
  }

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError(null)
    try {
      const tagIds = await Promise.all(tagLabels.map(l => getOrCreateTag(l, tags)))
      await Promise.all(tagIds.map(id => incrementTagUsage(id)))

      await addItem({
        name: trimmedName,
        photoUrl: photoUrl ?? undefined,
        description: description.trim() || undefined,
        tags: tagIds,
        character: character.trim() || undefined,
        itemType,
        locationId: locationId || undefined,
        binId: binId || undefined,
        status: 'available',
        whereToRebuy: whereToRebuy.trim() || undefined,
        cost: cost ? parseFloat(cost) : undefined,
        embedding: undefined,
      })
      navigate('/')
    } catch {
      setError('Save failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const charSuggestions = characterOptions.filter(c =>
    character && c.toLowerCase().includes(character.toLowerCase())
  )

  const canSave = !!name.trim() && !saving && uploadProgress === null

  return (
    <div className="min-h-screen bg-pt-bg pb-28">
      {/* Header */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button
          onClick={() => navigate(-1)}
          className="text-pt-muted text-sm active:text-pt-text py-1"
        >
          Cancel
        </button>
        <h1 className="font-display text-lg text-pt-text">Add Item</h1>
        <div className="w-14" />
      </div>

      <div className="p-4 space-y-5">
        {/* Photo */}
        <PhotoPicker
          previewUrl={photoPreview}
          uploadProgress={uploadProgress}
          onFileSelected={handleFileSelected}
        />

        {/* Name */}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="What is it? *"
          autoFocus
          className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3.5 text-pt-text text-lg placeholder-pt-muted focus:outline-none focus:border-pt-accent"
        />

        {/* Item type */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Type</p>
          <div className="flex gap-2 flex-wrap">
            {ITEM_TYPES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setItemType(value)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors active:opacity-80 ${
                  itemType === value
                    ? 'bg-pt-accent text-stone-900'
                    : 'bg-pt-surface border border-pt-border text-pt-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Location</p>
          <select
            value={locationId}
            onChange={e => { setLocationId(e.target.value); setBinId('') }}
            className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text focus:outline-none focus:border-pt-accent"
          >
            <option value="">No location</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* Bin — only shown when location has bins */}
        {locationId && filteredBins.length > 0 && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Bin</p>
            <select
              value={binId}
              onChange={e => setBinId(e.target.value)}
              className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text focus:outline-none focus:border-pt-accent"
            >
              <option value="">No bin</option>
              {filteredBins.map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Tags */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Tags</p>
          <TagInput value={tagLabels} onChange={setTagLabels} suggestions={tags} />
        </div>

        {/* Character */}
        <div className="relative">
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Character (optional)</p>
          <input
            value={character}
            onChange={e => { setCharacter(e.target.value); setShowCharSuggestions(true) }}
            onFocus={() => setShowCharSuggestions(true)}
            onBlur={() => setTimeout(() => setShowCharSuggestions(false), 150)}
            placeholder="e.g. Wednesday Addams"
            className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
          />
          {showCharSuggestions && charSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-pt-surface border border-pt-border rounded-xl overflow-hidden z-20 shadow-xl">
              {charSuggestions.slice(0, 5).map(c => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={() => { setCharacter(c); setShowCharSuggestions(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-pt-text active:bg-pt-border"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* More details toggle */}
        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          className="w-full flex items-center justify-center gap-2 text-pt-muted text-sm py-1"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 transition-transform ${showMore ? 'rotate-180' : ''}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
          {showMore ? 'Hide extra details' : 'Add notes, cost, where to rebuy'}
        </button>

        {showMore && (
          <div className="space-y-4">
            <div>
              <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Notes / Description</p>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Details, condition, searchable notes…"
                rows={3}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
              />
            </div>
            <div>
              <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Cost (optional)</p>
              <input
                value={cost}
                onChange={e => setCost(e.target.value)}
                placeholder="0.00"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
              />
            </div>
            <div>
              <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Where to rebuy (optional)</p>
              <input
                value={whereToRebuy}
                onChange={e => setWhereToRebuy(e.target.value)}
                placeholder="e.g. Dollarama, Amazon: search 'fake eyeballs'"
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">{error}</p>
        )}
      </div>

      {/* Sticky save button */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg disabled:opacity-40 active:opacity-80"
        >
          {saving
            ? 'Saving…'
            : uploadProgress !== null
              ? `Uploading photo… ${Math.round(uploadProgress)}%`
              : 'Save Item'}
        </button>
      </div>
    </div>
  )
}
