import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { deleteField } from 'firebase/firestore'
import { auth, storage } from '../firebase'
import { addItem, updateItem, getItem } from '../services/items'
import { getOrCreateTag, incrementTagUsage, decrementTagUsage } from '../services/tags'
import { getOrCreateCharacter, incrementCharacterUsage, decrementCharacterUsage } from '../services/characters'
import { analyzeItemPhoto, generateEmbedding } from '../services/ai'
import type { PhotoAnalysis } from '../services/ai'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useTags } from '../hooks/useTags'
import { useCharacters } from '../hooks/useCharacters'
import { useCategories } from '../hooks/useCategories'
import PhotoPicker, { type PhotoSlot } from '../components/PhotoPicker'
import { CONDITION_LABELS } from '../components/ItemCard'
import TagInput from '../components/TagInput'
import CharacterInput from '../components/CharacterInput'
import type { Item, Condition } from '../types'

export default function AddItemScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { id: editId } = useParams<{ id: string }>()
  const isEditMode = !!editId

  const locations   = useLocations()
  const bins        = useBins()
  const tags        = useTags()
  const characters  = useCharacters()
  const categories  = useCategories()

  const [photos, setPhotos] = useState<PhotoSlot[]>([])

  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') ?? 'prop')
  const [quantity, setQuantity] = useState('1')
  const [condition, setCondition] = useState<Condition>('good')
  const [notes, setNotes] = useState('')
  const [locationId, setLocationId] = useState(searchParams.get('locationId') ?? '')
  const [binId, setBinId] = useState(searchParams.get('binId') ?? '')
  const [tagLabels, setTagLabels] = useState<string[]>([])
  const [characterLabels, setCharacterLabels] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [replacementCost, setReplacementCost] = useState('')
  const [whereToRebuy, setWhereToRebuy] = useState('')
  const [showMore, setShowMore] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNoLocationWarning, setShowNoLocationWarning] = useState(false)

  const [aiResult, setAiResult]     = useState<PhotoAnalysis | null>(null)
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiError, setAiError]       = useState<string | null>(null)
  const lastFileRef                 = useRef<File | null>(null)

  // For edit mode: original IDs to compute delta on save
  const [originalTagIds, setOriginalTagIds] = useState<string[]>([])
  const [originalCharacterIds, setOriginalCharacterIds] = useState<string[]>([])
  const [loadingItem, setLoadingItem] = useState(isEditMode)
  const [editItem, setEditItem] = useState<Item | null>(null)
  const tagsInitialized = useRef(false)
  const charsInitialized = useRef(false)

  // Load existing item when in edit mode
  useEffect(() => {
    if (!editId) return
    getItem(editId).then(data => {
      if (!data) { setLoadingItem(false); return }
      setEditItem(data)
      setOriginalTagIds(data.tags)
      setOriginalCharacterIds(data.characters ?? [])
      setName(data.name)
      setCategoryId(data.categoryId)
      setQuantity(String(data.quantity))
      setCondition(data.condition)
      setNotes(data.notes ?? '')
      setLocationId(data.locationId ?? '')
      setBinId(data.binId ?? '')
      setDescription(data.description ?? '')
      setReplacementCost(data.replacementCost != null ? String(data.replacementCost) : '')
      setWhereToRebuy(data.whereToRebuy ?? '')
      setPhotos(data.photos.map(url => ({ key: url, preview: url, url, progress: null })))
      if (data.description || data.notes || data.whereToRebuy) setShowMore(true)
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

  // Convert character IDs → labels once both editItem and characters are ready
  // Falls back to legacy single-string character field for old items
  useEffect(() => {
    if (!editItem || charsInitialized.current) return
    if (editItem.characters && editItem.characters.length > 0) {
      if (characters.length === 0) return
      charsInitialized.current = true
      setCharacterLabels(
        editItem.characters
          .map(id => characters.find(c => c.id === id)?.label)
          .filter((l): l is string => !!l)
      )
    } else if (editItem.character) {
      charsInitialized.current = true
      setCharacterLabels([editItem.character])
    } else {
      charsInitialized.current = true
    }
  }, [editItem, characters])

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

  function handleFilesSelected(files: File[]) {
    const uid = auth.currentUser?.uid ?? 'unknown'
    // Ask the AI about the first photo only, and only if we haven't already.
    if (!aiResult && !aiLoading && photos.length === 0) runAnalysis(files[0])

    for (const file of files) {
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      setPhotos(prev => [...prev, { key, preview: URL.createObjectURL(file), url: null, progress: 0 }])
      const patch = (p: Partial<PhotoSlot>) =>
        setPhotos(prev => prev.map(x => x.key === key ? { ...x, ...p } : x))

      const task = uploadBytesResumable(storageRef(storage, `items/${uid}/${key}_${file.name}`), file)
      task.on(
        'state_changed',
        snap => patch({ progress: (snap.bytesTransferred / snap.totalBytes) * 100 }),
        () => patch({ failed: true, progress: null }),
        () => getDownloadURL(task.snapshot.ref).then(url => patch({ url, progress: null })),
      )
    }
  }

  function removePhoto(key: string) {
    setPhotos(prev => prev.filter(p => p.key !== key))
  }

  function makeCover(key: string) {
    setPhotos(prev => [...prev.filter(p => p.key === key), ...prev.filter(p => p.key !== key)])
  }

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError(null)
    try {
      const embeddingText = [trimmedName, description, tagLabels.join(' '), characterLabels.join(' ')]
        .filter(Boolean).join(' ')

      const [newTagIds, newCharacterIds, embedding] = await Promise.all([
        Promise.all(tagLabels.map(l => getOrCreateTag(l, tags))),
        Promise.all(characterLabels.map(l => getOrCreateCharacter(l, characters))),
        generateEmbedding(embeddingText),
      ])

      const photoUrls = photos.map(p => p.url).filter((u): u is string => !!u)
      const qty = Math.max(1, Math.floor(Number(quantity) || 1))
      const costValue = replacementCost.trim() === '' ? undefined : Math.max(0, parseFloat(replacementCost))
      const common = {
        name: trimmedName,
        photos: photoUrls,
        photoUrl: photoUrls[0],
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: newTagIds,
        characters: newCharacterIds,
        categoryId,
        quantity: qty,
        condition,
        locationId: locationId || undefined,
        binId: binId || undefined,
        whereToRebuy: whereToRebuy.trim() || undefined,
        replacementCost: Number.isFinite(costValue) ? costValue : undefined,
        ...(embedding ? { embedding } : {}),
      }

      if (isEditMode && editId) {
        const addedTagIds      = newTagIds.filter(id => !originalTagIds.includes(id))
        const removedTagIds    = originalTagIds.filter(id => !newTagIds.includes(id))
        const addedCharIds     = newCharacterIds.filter(id => !originalCharacterIds.includes(id))
        const removedCharIds   = originalCharacterIds.filter(id => !newCharacterIds.includes(id))
        await Promise.all([
          ...addedTagIds.map(id => incrementTagUsage(id)),
          ...removedTagIds.map(id => decrementTagUsage(id)),
          ...addedCharIds.map(id => incrementCharacterUsage(id)),
          ...removedCharIds.map(id => decrementCharacterUsage(id)),
        ])
        // A blank field here should clear the stored value, so send explicit deletes.
        await updateItem(editId, {
          ...common,
          // Older records stored "damaged" as a status; condition replaces it.
          status: editItem?.status ?? 'available',
          photoUrl: common.photoUrl ?? deleteField(),
          description: common.description ?? deleteField(),
          notes: common.notes ?? deleteField(),
          locationId: common.locationId ?? deleteField(),
          binId: common.binId ?? deleteField(),
          whereToRebuy: common.whereToRebuy ?? deleteField(),
          replacementCost: common.replacementCost ?? deleteField(),
          // Clearing the cost also clears the legacy field it used to be read from.
          ...(common.replacementCost === undefined ? { cost: deleteField() } : {}),
        } as unknown as Partial<Item>)
        navigate(`/item/${editId}`, { replace: true })
      } else {
        await Promise.all([
          ...newTagIds.map(id => incrementTagUsage(id)),
          ...newCharacterIds.map(id => incrementCharacterUsage(id)),
        ])
        await addItem({ ...common, status: 'available', archived: false })
        navigate('/')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const uploading = photos.some(p => p.url === null && !p.failed)
  const failedUploads = photos.some(p => p.failed)
  const canSave = !!name.trim() && !saving && !uploading && !failedUploads

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
          className="text-pt-text text-base font-medium active:text-pt-muted py-1"
        >
          Cancel
        </button>
        <h1 className="font-display text-xl text-pt-text">
          {isEditMode ? 'Edit Item' : 'Add Item'}
        </h1>
        <div className="w-14" />
      </div>

      <div className="p-4 space-y-5">
        {/* Photo */}
        <PhotoPicker
          photos={photos}
          onAdd={handleFilesSelected}
          onRemove={removePhoto}
          onMakeCover={makeCover}
        />
        {failedUploads && (
          <p className="text-red-400 text-sm">A photo didn't upload. Remove it (×) and try adding it again.</p>
        )}

        {/* AI analysis card — visible as soon as photo is picked */}
        {photos.length > 0 && (aiLoading || aiResult || aiError) && (
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

        {/* Category */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Category</p>
          <div className="flex gap-2 flex-wrap">
            {categories.filter(c => c.active || c.id === categoryId).map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors active:opacity-80 ${
                  categoryId === c.id
                    ? 'bg-pt-accent text-stone-900'
                    : 'bg-pt-surface border border-pt-border text-pt-muted'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity + replacement cost */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Quantity</p>
            <input
              value={quantity}
              onChange={e => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => setQuantity(q => String(Math.max(1, Number(q) || 1)))}
              inputMode="numeric"
              className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text focus:outline-none focus:border-pt-accent"
            />
            <p className="text-pt-muted text-xs mt-1">1 = one-of-a-kind</p>
          </div>
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Replacement cost</p>
            <input
              value={replacementCost}
              onChange={e => setReplacementCost(e.target.value)}
              placeholder="$0.00"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
            />
            <p className="text-pt-muted text-xs mt-1">Per unit, in CAD</p>
          </div>
        </div>

        {/* Condition */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Condition</p>
          <div className="flex gap-2">
            {(['good', 'fair', 'damaged'] as Condition[]).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors active:opacity-80 ${
                  condition === c
                    ? 'bg-pt-accent text-stone-900'
                    : 'bg-pt-surface border border-pt-border text-pt-muted'
                }`}
              >
                {CONDITION_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Storage area</p>
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
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Character (optional, arts dept only)</p>
          <CharacterInput value={characterLabels} onChange={setCharacterLabels} suggestions={characters} />
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
          {showMore ? 'Hide extra details' : 'Add description, notes, where to rebuy'}
        </button>

        {showMore && (
          <div className="space-y-4">
            <div>
              <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Description</p>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What it looks like (the AI can suggest this)"
                rows={2}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
              />
            </div>
            <div>
              <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Notes</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Handling instructions, missing parts, sizes…"
                rows={3}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
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
            : uploading
              ? 'Uploading photos…'
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
