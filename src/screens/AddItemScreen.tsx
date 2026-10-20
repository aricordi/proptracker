import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { deleteField } from 'firebase/firestore'
import { auth, storage } from '../firebase'
import { addItem, updateItem, getItem } from '../services/items'
import { getOrCreateTag, incrementTagUsage, decrementTagUsage } from '../services/tags'
import { getOrCreateCharacter, incrementCharacterUsage, decrementCharacterUsage } from '../services/characters'
import { analyzeItemPhoto } from '../services/ai'
import { getItemPrivate, setItemPrivate } from '../services/itemPrivate'
import { normalizeTag } from '../lib/normalizeTag'
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
import { useSession } from '../auth'
import { COLLECTION_LABELS, type PropCollection } from '../../functions/src/collections'
import { shrinkPhoto } from '../lib/shrinkPhoto'

export default function AddItemScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { id: editId } = useParams<{ id: string }>()
  const isEditMode = !!editId
  const { isOwner } = useSession()
  // New props are Prime Capitol's unless the owner says they're personal.
  const [collection, setCollection] = useState<PropCollection>('company')

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
  const [internalNotes, setInternalNotes] = useState('')
  const [originalInternalNotes, setOriginalInternalNotes] = useState('')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [aiFilled, setAiFilled] = useState<Set<'name' | 'category' | 'tags' | 'description' | 'searchWords'>>(new Set())
  const [locationId, setLocationId] = useState(searchParams.get('locationId') ?? '')
  const [binId, setBinId] = useState(searchParams.get('binId') ?? '')
  const [tagLabels, setTagLabels] = useState<string[]>([])
  const [characterLabels, setCharacterLabels] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [searchWords, setSearchWords] = useState('')   // hidden extra search words, comma-separated
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
      setCollection(data.collection)
      setNotes(data.notes ?? '')
      setLocationId(data.locationId ?? '')
      setBinId(data.binId ?? '')
      setDescription(data.description ?? '')
      setSearchWords((data.searchWords ?? []).join(', '))
      setReplacementCost(data.replacementCost != null ? String(data.replacementCost) : '')
      setWhereToRebuy(data.whereToRebuy ?? '')
      setPhotos(data.photos.map(url => ({ key: url, preview: url, url, progress: null })))
      if (data.description || data.notes || data.whereToRebuy) setShowMore(true)
      getItemPrivate(data.id).then(p => {
        setInternalNotes(p.internalNotes ?? '')
        setOriginalInternalNotes(p.internalNotes ?? '')
        if (p.internalNotes) setShowMore(true)
      }).catch(() => {})
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
        applyAi(result)
      })
      .catch(err => setAiError(err instanceof Error ? err.message : 'Analysis failed'))
      .finally(() => setAiLoading(false))
  }

  // The AI answers a few seconds after the photo is picked; by then the admin
  // may have typed. Read the latest values from here, not from a stale closure.
  const latest = useRef({ name, description, tagLabels, categoryTouched, searchWords })
  latest.current = { name, description, tagLabels, categoryTouched, searchWords }

  // Fill in whatever the admin hasn't already typed or picked themselves.
  function applyAi(result: PhotoAnalysis) {
    const now = latest.current
    const filled = new Set<'name' | 'category' | 'tags' | 'description' | 'searchWords'>()
    if (result.name && !now.name.trim()) { setName(result.name); filled.add('name') }
    if (result.categoryId && !now.categoryTouched) { setCategoryId(result.categoryId); filled.add('category') }
    if (result.description && !now.description.trim()) { setDescription(result.description); filled.add('description'); setShowMore(true) }
    if (result.searchWords?.length && !now.searchWords.trim()) { setSearchWords(result.searchWords.join(', ')); filled.add('searchWords') }
    if (result.tags.length) {
      // Reuse the existing spelling of a tag ("chairs" → existing "chair") so tags don't multiply.
      const existing = new Map(tags.map(t => [t.normalizedKey || normalizeTag(t.label), t.label]))
      const have = new Set(now.tagLabels.map(normalizeTag))
      const add = result.tags
        .map(t => existing.get(normalizeTag(t)) ?? t)
        .filter(t => { const k = normalizeTag(t); if (have.has(k)) return false; have.add(k); return true })
      if (add.length) { setTagLabels([...now.tagLabels, ...add]); filled.add('tags') }
    }
    setAiFilled(filled)
  }

  function handleFilesSelected(files: File[]) {
    const uid = auth.currentUser?.uid ?? 'unknown'
    // Ask the AI about the first photo only, and only if we haven't already.
    if (!isEditMode && !aiResult && !aiLoading && photos.length === 0) runAnalysis(files[0])

    for (const file of files) {
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      setPhotos(prev => [...prev, { key, preview: URL.createObjectURL(file), url: null, progress: 0 }])
      const patch = (p: Partial<PhotoSlot>) =>
        setPhotos(prev => prev.map(x => x.key === key ? { ...x, ...p } : x))

      void shrinkPhoto(file).then(blob => {
      const jpeg = blob !== file
      const name = jpeg ? `${key}.jpg` : `${key}_${file.name}`
      const task = uploadBytesResumable(storageRef(storage, `items/${uid}/${name}`), blob, jpeg ? { contentType: 'image/jpeg' } : undefined)
      task.on(
        'state_changed',
        snap => patch({ progress: (snap.bytesTransferred / snap.totalBytes) * 100 }),
        () => patch({ failed: true, progress: null }),
        () => getDownloadURL(task.snapshot.ref).then(url => patch({ url, progress: null })),
      )
      })
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
      const [newTagIds, newCharacterIds] = await Promise.all([
        Promise.all(tagLabels.map(l => getOrCreateTag(l, tags))),
        Promise.all(characterLabels.map(l => getOrCreateCharacter(l, characters))),
      ])

      const photoUrls = photos.map(p => p.url).filter((u): u is string => !!u)
      const qty = Math.max(1, Math.floor(Number(quantity) || 1))
      const costValue = replacementCost.trim() === '' ? undefined : Math.max(0, parseFloat(replacementCost))
      const common = {
        name: trimmedName,
        photos: photoUrls,
        photoUrl: photoUrls[0],
        description: description.trim() || undefined,
        searchWords: searchWordList(searchWords),
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
        collection,
      }
      const savePrivate = (id: string) => internalNotes.trim() !== originalInternalNotes.trim()
        ? setItemPrivate(id, { internalNotes: internalNotes.trim() })
        : Promise.resolve()

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
          searchWords: common.searchWords ?? deleteField(),
          notes: common.notes ?? deleteField(),
          locationId: common.locationId ?? deleteField(),
          binId: common.binId ?? deleteField(),
          // Given a bin again: off the "Needs a bin" list.
          ...(common.binId ? { lostFromBin: deleteField() } : {}),
          whereToRebuy: common.whereToRebuy ?? deleteField(),
          replacementCost: common.replacementCost ?? deleteField(),
          // Clearing the cost also clears the legacy field it used to be read from.
          ...(common.replacementCost === undefined ? { cost: deleteField() } : {}),
        } as unknown as Partial<Item>)
        await savePrivate(editId)
        navigate(`/item/${editId}`, { replace: true })
      } else {
        await Promise.all([
          ...newTagIds.map(id => incrementTagUsage(id)),
          ...newCharacterIds.map(id => incrementCharacterUsage(id)),
        ])
        const ref = await addItem({ ...common, status: 'available', archived: false })
        await savePrivate(ref.id)
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
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between">
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

      <div className="px-4 pt-4 pb-8 space-y-6">
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
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
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
                  className="text-pt-accent text-xs shrink-0 active:opacity-70 tap"
                >
                  Retry
                </button>
              </div>
            )}

            {aiResult && !aiLoading && (
              <p className="text-pt-text text-sm">
                <span className="text-pt-accent">✦</span>{' '}
                {aiFilled.size > 0
                  ? <>AI filled in the fields marked <span className="text-pt-accent">✦</span>. Check them before saving.</>
                  : 'AI had nothing new to add. Your entries were kept.'}
              </p>
            )}
          </div>
        )}

        {/* Name */}
        <input
          value={name}
          onChange={e => { setName(e.target.value); setAiFilled(f => { const n = new Set(f); n.delete('name'); return n }) }}
          placeholder="What is it? *"
          className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-4 text-pt-text text-lg placeholder-pt-muted focus:outline-none focus:border-pt-accent"
        />
        {aiFilled.has('name') && <p className="-mt-3 text-xs text-pt-muted"><AiMark /> suggested name</p>}

        {/* Category */}
        <div>
          <p className="text-pt-muted text-xs mb-2">Category{aiFilled.has('category') && <AiMark />}</p>
          <div className="flex gap-2 flex-wrap">
            {categories.filter(c => c.active || c.id === categoryId).map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setCategoryId(c.id); setCategoryTouched(true); setAiFilled(f => { const n = new Set(f); n.delete('category'); return n }) }}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors active:opacity-80 ${
                  categoryId === c.id
                    ? 'bg-pt-accent text-stone-900'
                    : 'bg-pt-surface shadow-hairline text-pt-muted'
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
            <p className="text-pt-muted text-xs mb-2">Quantity</p>
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
            <p className="text-pt-muted text-xs mb-2">Replacement cost</p>
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

        {/* Which inventory (owner only; the arts department only adds Prime Capitol props) */}
        {isOwner && (
          <div>
            <p className="text-pt-muted text-xs mb-2">Belongs to</p>
            <div className="flex gap-2">
              {(['company', 'personal'] as PropCollection[]).map(c => (
                <button key={c} type="button" onClick={() => setCollection(c)}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium border ${collection === c ? 'bg-pt-accent text-stone-900 border-transparent' : 'bg-pt-surface border-pt-border text-pt-muted'}`}>
                  {COLLECTION_LABELS[c]}
                </button>
              ))}
            </div>
            {collection === 'personal' && <p className="text-pt-muted text-xs mt-1">Only you will see this prop. Nobody else can find or book it.</p>}
          </div>
        )}

        {/* Condition */}
        <div>
          <p className="text-pt-muted text-xs mb-2">Condition</p>
          <div className="flex gap-2">
            {(['good', 'fair', 'damaged'] as Condition[]).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors active:opacity-80 ${
                  condition === c
                    ? 'bg-pt-accent text-stone-900'
                    : 'bg-pt-surface shadow-hairline text-pt-muted'
                }`}
              >
                {CONDITION_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div>
          <p className="text-pt-muted text-xs mb-2">Storage area</p>
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
            <p className="text-pt-muted text-xs mb-2">Bin</p>
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
          <p className="text-pt-muted text-xs mb-2">Tags{aiFilled.has('tags') && <AiMark />}</p>
          <TagInput value={tagLabels} onChange={setTagLabels} suggestions={tags} />

        </div>

        {/* Character */}
        <div>
          <p className="text-pt-muted text-xs mb-2">Character (optional, arts dept only)</p>
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
          {showMore ? 'Hide extra details' : 'Description, search words, notes, where to rebuy'}
        </button>

        {showMore && (
          <div className="space-y-4">
            <div>
              <p className="text-pt-muted text-xs mb-2">Description{aiFilled.has('description') && <AiMark />}</p>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What it looks like (the AI can suggest this)"
                rows={2}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
              />
            </div>
            <div>
              <p className="text-pt-muted text-xs mb-2">Extra search words{aiFilled.has('searchWords') && <AiMark />}</p>
              <textarea
                value={searchWords}
                onChange={e => setSearchWords(e.target.value)}
                placeholder="e.g. president, civil war, history (separate with commas)"
                rows={2}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
              />
              <p className="text-pt-muted text-xs mt-1">Not shown on the prop page. Search uses them to find this prop.</p>
            </div>
            <div>
              <p className="text-pt-muted text-xs mb-2">Notes for creators</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Everyone sees this: handling, sizes, missing parts…"
                rows={3}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
              />
            </div>
            <div>
              <p className="text-pt-muted text-xs mb-2">Internal notes (arts dept only)</p>
              <textarea
                value={internalNotes}
                onChange={e => setInternalNotes(e.target.value)}
                placeholder="Creators never see this: repairs, where it came from…"
                rows={3}
                className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none"
              />
            </div>
            <div>
              <p className="text-pt-muted text-xs mb-2">Where to rebuy (optional)</p>
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
          className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg disabled:opacity-40 active:opacity-80 shadow-gold"
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
        <div className="relative w-full bg-pt-surface rounded-t-[28px] p-6 space-y-4">
          <h3 className="font-display text-xl text-pt-text">No location set</h3>
          <p className="text-pt-muted text-sm leading-relaxed">
            This item won't be linked to any storage location. You can assign one later by editing the item.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowNoLocationWarning(false)}
              className="flex-1 py-4 rounded-2xl shadow-hairline text-pt-muted font-medium active:opacity-70"
            >
              Go Back
            </button>
            <button
              onClick={() => { setShowNoLocationWarning(false); handleSave() }}
              className="flex-1 py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold active:opacity-80 shadow-gold"
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

// Small marker beside a field the AI filled in.
function AiMark() {
  return <span className="text-pt-accent normal-case tracking-normal ml-2">✦ AI</span>
}

// "president, Civil War,, history" → ['president', 'civil war', 'history'] (undefined if empty).
function searchWordList(text: string): string[] | undefined {
  const list = [...new Set(text.split(/[,\n]/).map(w => w.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 40)
  return list.length ? list : undefined
}
