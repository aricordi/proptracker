import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { getDocs, getDoc, collection, doc } from 'firebase/firestore'
import { auth, storage, db } from '../firebase'
import { addItem, updateItem } from '../services/items'
import { getOrCreateTag, incrementTagUsage, decrementTagUsage } from '../services/tags'
import { analyzeItemPhoto, generateEmbedding } from '../services/ai'
import type { PhotoAnalysis } from '../services/ai'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useTags } from '../hooks/useTags'
import PhotoPicker from '../components/PhotoPicker'
import TagInput from '../components/TagInput'
import type { Item, ItemType } from '../types'

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: 'prop', label: 'Prop' },
  { value: 'costume', label: 'Costume' },
  { value: 'set-dressing', label: 'Set Dressing' },
  { value: 'gear', label: 'Gear' },
]

export default function AddItemScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { id: editId } = useParams<{ id: string }>()
  const isEditMode = !!editId

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
  const [showNoLocationWarning, setShowNoLocationWarning] = useState(false)

  const [aiResult, setAiResult]     = useState<PhotoAnalysis | null>(null)
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiError, setAiError]       = useState<string | null>(null)
  const lastFileRef                 = useRef<File | null>(null)

  // For edit mode: original tag IDs to compute delta on save
  const [originalTagIds, setOriginalTagIds] = useState<string[]>([])
  const [loadingItem, setLoadingItem] = useState(isEditMode)
  const [editItem, setEditItem] = useState<Item | null>(null)
  const tagsInitialized = useRef(false)

  // Load existing item when in edit mode
  useEffect(() => {
    if (!editId) return
    getDoc(doc(db, 'items', editId)).then(d => {
      if (!d.exists()) { setLoadingItem(false); return }
      const data = { id: d.id, ...d.data() } as Item
      setEditItem(data)
      setOriginalTagIds(data.tags)
      setName(data.name)
      setItemType(data.itemType)
      setLocationId(data.locationId ?? '')
      setBinId(data.binId ?? '')
      setCharacter(data.character ?? '')
      setDescription(data.description ?? '')
      setCost(data.cost != null ? String(data.cost) : '')
      setWhereToRebuy(data.whereToRebuy ?? '')
      if (data.photoUrl) {
        setPhotoPreview(data.photoUrl)
        setPhotoUrl(data.photoUrl)
      }
      if (data.description || data.cost != null || data.whereToRebuy) setShowMore(true)
      setLoadingItem(false)
    }).catch(() => setLoadingItem(false))
  }, [editId])

  // Convert tag IDs → labels once both editItem and tags are ready
  useEffect(() => {
    if (!editItem || tagsInitialized.current) return
    if (tags.length === 0 && editItem.tags.length > 0) return
    tagsInitialized.current = true
    setTagLabels(
      editItem.tags
        .map(tagId => tags.find(t => t.id === tagId)?.label)
        .filter((l): l is string => !!l)
    )
  }, [editItem, tags])

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

  function runAnalysis(file: File) {
    lastFileRef.current = file
    setAiResult(null)
    setAiError(null)
    setAiLoading(true)
    analyzeItemPhoto(file)
      .then(result => {
        setAiResult(result)
        // Auto-expand More Details if a description was suggested and field is empty
        if (result.description) setShowMore(true)
      })
      .catch(err => setAiError(err instanceof Error ? err.message : 'Analysis failed'))
      .finally(() => setAiLoading(false))
  }

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

    runAnalysis(file)
  }

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError(null)
    try {
      const embeddingText = [trimmedName, description, tagLabels.join(' '), character]
        .filter(Boolean).join(' ')

      const [newTagIds, embedding] = await Promise.all([
        Promise.all(tagLabels.map(l => getOrCreateTag(l, tags))),
        generateEmbedding(embeddingText),
      ])

      if (isEditMode && editId) {
        const addedIds   = newTagIds.filter(id => !originalTagIds.includes(id))
        const removedIds = originalTagIds.filter(id => !newTagIds.includes(id))
        await Promise.all([
          ...addedIds.map(id => incrementTagUsage(id)),
          ...removedIds.map(id => decrementTagUsage(id)),
        ])
        await updateItem(editId, {
          name: trimmedName,
          photoUrl: photoUrl ?? undefined,
          description: description.trim() || undefined,
          tags: newTagIds,
          character: character.trim() || undefined,
          itemType,
          locationId: locationId || undefined,
          binId: binId || undefined,
          whereToRebuy: whereToRebuy.trim() || undefined,
          cost: cost ? parseFloat(cost) : undefined,
          ...(embedding ? { embedding } : {}),
        })
        navigate(`/item/${editId}`, { replace: true })
      } else {
        await Promise.all(newTagIds.map(id => incrementTagUsage(id)))
        await addItem({
          name: trimmedName,
          photoUrl: photoUrl ?? undefined,
          description: description.trim() || undefined,
          tags: newTagIds,
          character: character.trim() || undefined,
          itemType,
          locationId: locationId || undefined,
          binId: binId || undefined,
          status: 'available',
          whereToRebuy: whereToRebuy.trim() || undefined,
          cost: cost ? parseFloat(cost) : undefined,
          ...(embedding ? { embedding } : {}),
        })
        navigate('/')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const charSuggestions = characterOptions.filter(c =>
    character && c.toLowerCase().includes(character.toLowerCase())
  )

  const canSave = !!name.trim() && !saving && uploadProgress === null

  if (loadingItem) {
    return (
      <div className="min-h-screen bg-pt-bg flex items-center justify-center">
        <p className="text-pt-muted text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col min-h-full bg-pt-bg">
      {/* Header */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button
          onClick={() => navigate(-1)}
          className="text-pt-muted text-sm active:text-pt-text py-1"
        >
          Cancel
        </button>
        <h1 className="font-display text-lg text-pt-text">
          {isEditMode ? 'Edit Item' : 'Add Item'}
        </h1>
        <div className="w-14" />
      </div>

      <div className="p-4 space-y-5">
        {/* Photo */}
        <PhotoPicker
          previewUrl={photoPreview}
          uploadProgress={uploadProgress}
          onFileSelected={handleFileSelected}
        />

        {/* AI analysis card — visible as soon as photo is picked */}
        {photoPreview && (aiLoading || aiResult || aiError) && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
            {aiLoading && (
              <div className="flex items-center gap-2 text-pt-muted text-sm">
                <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Analyzing photo…
              </div>
            )}

            {aiError && !aiLoading && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-pt-muted text-xs">Analysis unavailable — {aiError.slice(0, 60)}</p>
                <button
                  type="button"
                  onClick={() => lastFileRef.current && runAnalysis(lastFileRef.current)}
                  className="text-pt-accent text-xs shrink-0 active:opacity-70"
                >
                  Retry
                </button>
              </div>
            )}

            {aiResult && !aiLoading && (
              <>
                {/* Tag chips */}
                {aiResult.tags.filter(t => !tagLabels.includes(t)).length > 0 && (
                  <div>
                    <p className="text-pt-muted text-xs mb-2">
                      <span className="text-pt-accent">✦</span> Tap to add tags
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {aiResult.tags.filter(t => !tagLabels.includes(t)).map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setTagLabels(prev => [...prev, tag])}
                          className="flex items-center gap-1 bg-pt-accent/10 border border-pt-accent/30 text-pt-accent text-sm px-2.5 py-1 rounded-full active:opacity-70"
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description suggestion */}
                {aiResult.description && !description && (
                  <button
                    type="button"
                    onClick={() => setDescription(aiResult.description!)}
                    className="w-full text-left bg-pt-accent/5 border border-pt-accent/20 rounded-xl px-3 py-2.5 active:opacity-70"
                  >
                    <p className="text-pt-muted text-xs mb-1">
                      <span className="text-pt-accent">✦</span> Tap to use description
                    </p>
                    <p className="text-pt-text text-sm">{aiResult.description}</p>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Name */}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="What is it? *"
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

      {/* Save button — sticky to bottom of scroll container, sits above BottomNav */}
      <div className="sticky bottom-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border mt-auto">
        <button
          onClick={() => !locationId ? setShowNoLocationWarning(true) : handleSave()}
          disabled={!canSave}
          className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg disabled:opacity-40 active:opacity-80"
        >
          {saving
            ? 'Saving…'
            : uploadProgress !== null
              ? `Uploading photo… ${Math.round(uploadProgress)}%`
              : isEditMode ? 'Save Changes' : 'Save Item'}
        </button>
      </div>
    </div>

    {/* No-location warning overlay */}
    {showNoLocationWarning && (
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/50" onClick={() => setShowNoLocationWarning(false)} />
        <div className="relative w-full bg-pt-surface rounded-t-2xl p-6 space-y-4">
          <h3 className="font-display text-xl text-pt-text">No location set</h3>
          <p className="text-pt-muted text-sm leading-relaxed">
            This item won't be linked to any storage location. You can assign one later by editing the item.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowNoLocationWarning(false)}
              className="flex-1 py-3.5 rounded-2xl border border-pt-border text-pt-muted font-medium active:opacity-70"
            >
              Go Back
            </button>
            <button
              onClick={() => { setShowNoLocationWarning(false); handleSave() }}
              className="flex-1 py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold active:opacity-80"
            >
              Save Anyway
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
