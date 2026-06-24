import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { OWNER_UID } from '../config'
import {
  subscribeToVideoChecklist, saveVideoChecklist, updateChecklistProp,
  mergeManifestIntoChecklist, dismissResyncFlags,
} from '../services/videoChecklists'
import { readPropManifest, getDriveToken, requestDriveAccess, DriveAuthError } from '../services/drive'
import { parseManifest } from '../services/manifestParser'
import { matchAllPhysicalProps } from '../services/propMatcher'
import { createCheckout } from '../services/checkout'
import { useItems } from '../hooks/useItems'
import type { VideoChecklist, VideoChecklistProp, Item } from '../types'

// ─── Lane assignment ─────────────────────────────────────────────────────────

type Lane = 'pull' | 'buy-improvise' | 'make' | 'generate' | 'cut'

function getLane(prop: VideoChecklistProp): Lane {
  if (prop.decision === 'cut') return 'cut'
  if (prop.type === 'ai') return 'generate'
  if (prop.type === 'handmade') return 'make'
  // physical:
  if (prop.decision === 'confirmed' || prop.decision === 'alternative') return 'pull'
  if (prop.decision === 'make') return 'make'
  if (prop.decision === 'buy' || prop.decision === 'rejected') return 'buy-improvise'
  // no decision yet
  if (prop.matchStatus === 'confident') return 'pull'
  return 'buy-improvise'
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function VideoChecklistScreen() {
  const { folderId } = useParams<{ folderId: string }>()
  const location     = useLocation()
  const navigate     = useNavigate()
  const items        = useItems()

  const [uid, setUid] = useState<string | null>(null)
  useEffect(() => onAuthStateChanged(auth, u => setUid(u?.uid ?? null)), [])
  const isOwner = uid === OWNER_UID

  const [checklist, setChecklist] = useState<VideoChecklist | null>(null)
  const [loading, setLoading]     = useState(true)
  const [building, setBuilding]   = useState(false)
  const [buildStep, setBuildStep]           = useState('')
  const [buildProgress, setBuildProgress]   = useState(0)
  const [buildError, setBuildError]         = useState<string | null>(null)
  const [resyncing, setResyncing]           = useState(false)
  const [resyncSummary, setResyncSummary]   = useState<{ addedCount: number; removedCount: number } | null>(null)
  const [cutExpanded, setCutExpanded]       = useState(false)
  const [checkingOut, setCheckingOut]       = useState(false)
  const [checkoutDone, setCheckoutDone]     = useState(false)
  const [parseWarnings, setParseWarnings]   = useState<string[]>([])

  // Subscribe to Firestore checklist
  useEffect(() => {
    if (!folderId) return
    return subscribeToVideoChecklist(folderId, cl => {
      setChecklist(cl)
      setLoading(false)
    })
  }, [folderId])

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const folderName = (location.state as { folderName?: string } | null)?.folderName ?? folderId ?? ''

  // ─── Build checklist from manifest (first time or explicit rebuild) ─────────

  const buildChecklist = useCallback(async (token: string, isResync = false) => {
    if (!folderId) return
    setBuilding(true)
    setBuildError(null)
    setBuildStep('Reading manifest from Drive…')
    setBuildProgress(5)

    try {
      const raw = await readPropManifest(token, folderId)
      if (!raw) {
        setBuildError('no-manifest')
        return
      }

      setBuildStep('Parsing props…')
      setBuildProgress(15)

      const parsed = parseManifest(raw)
      if ('type' in parsed) {
        setBuildError(parsed.message)
        return
      }

      setParseWarnings(parsed.parseWarnings)

      const physicalCount = parsed.props.filter(p => p.type === 'physical').length
      setBuildStep(physicalCount > 0
        ? `Matching ${physicalCount} prop${physicalCount !== 1 ? 's' : ''} to your inventory…`
        : 'Building checklist…'
      )
      setBuildProgress(20)

      // Run matching for physical props, updating progress bar per-prop
      const matchedProps = await matchAllPhysicalProps(
        parsed.props,
        items,
        (current, total, propName) => {
          setBuildStep(`Matching: ${propName}`)
          setBuildProgress(20 + Math.round((current / total) * 70))
        },
      )

      setBuildStep('Saving checklist…')
      setBuildProgress(95)

      const now = new Date().toISOString()

      if (isResync && checklist) {
        // Merge incoming props with existing, preserving user decisions
        const { merged, summary } = mergeManifestIntoChecklist(checklist.props, matchedProps)
        const updated: VideoChecklist = {
          ...checklist,
          videoTitle: parsed.videoTitle,
          manifestVersion: parsed.version,
          manifestLastRead: now,
          updatedAt: now,
          props: merged,
        }
        await saveVideoChecklist(updated)
        if (summary.addedCount > 0 || summary.removedCount > 0) {
          setResyncSummary(summary)
        }
      } else {
        // Fresh build
        const fresh: VideoChecklist = {
          id: folderId,
          videoTitle: parsed.videoTitle,
          driveFolderName: folderName,
          manifestVersion: parsed.version,
          manifestLastRead: now,
          builtAt: now,
          updatedAt: now,
          props: matchedProps,
        }
        await saveVideoChecklist(fresh)
      }
    } catch (err) {
      if (err instanceof DriveAuthError) {
        setBuildError('Drive access expired. Reconnect Drive on the Videos screen.')
      } else {
        setBuildError(err instanceof Error ? err.message : 'Failed to build checklist.')
      }
    } finally {
      setBuilding(false)
    }
  }, [folderId, items, checklist, folderName])

  // Auto-build fires at most once per mount. Using a ref so a failed build
  // (no manifest, bad token, etc.) doesn't loop — the user retries manually.
  const hasAutoBuild = useRef(false)
  useEffect(() => {
    if (!loading && !checklist && isOwner && !hasAutoBuild.current) {
      const token = getDriveToken()
      if (token) {
        hasAutoBuild.current = true
        buildChecklist(token)
      }
    }
  }, [loading, checklist, isOwner])

  // ─── Re-sync ────────────────────────────────────────────────────────────────

  async function handleResync() {
    let token = getDriveToken()
    if (!token) {
      try { token = await requestDriveAccess() } catch { return }
    }
    setResyncing(true)
    await buildChecklist(token, true)
    setResyncing(false)
  }

  async function dismissResync() {
    if (!checklist) return
    const updated = { ...checklist, props: dismissResyncFlags(checklist.props) }
    setResyncSummary(null)
    await saveVideoChecklist(updated)
  }

  // ─── Prop decision helpers ───────────────────────────────────────────────────

  async function setPropDecision(propId: string, patch: Partial<VideoChecklistProp>) {
    if (!checklist) return
    const updated = checklist.props.map(p => p.id === propId ? { ...p, ...patch } : p)
    await updateChecklistProp(checklist.id, updated)
  }

  async function toggleChecked(propId: string) {
    const prop = checklist?.props.find(p => p.id === propId)
    if (!prop) return
    await setPropDecision(propId, { checked: !prop.checked })
  }

  // ─── One-click checkout ──────────────────────────────────────────────────────

  async function handleCheckout() {
    if (!checklist) return
    const itemIds: string[] = []
    for (const prop of checklist.props) {
      if (prop.decision === 'confirmed' && prop.matchedItemId) itemIds.push(prop.matchedItemId)
      else if (prop.decision === 'alternative' && prop.alternativeItemId) itemIds.push(prop.alternativeItemId)
    }
    if (itemIds.length === 0) return
    setCheckingOut(true)
    try {
      await createCheckout(checklist.videoTitle, itemIds)
      setCheckoutDone(true)
    } catch (err) {
      console.error('Checkout failed:', err)
    } finally {
      setCheckingOut(false)
    }
  }

  // ─── Lane rendering ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-pt-bg flex items-center justify-center">
        <p className="text-pt-muted text-sm">Loading…</p>
      </div>
    )
  }

  // Owner sees build UI if no checklist yet
  if (!checklist && isOwner) {
    return (
      <div className="min-h-screen bg-pt-bg">
        <Header title={folderName} onBack={() => navigate('/videos')} />
        <div className="p-6 space-y-4 text-center mt-10">
          {building ? (
            <BuildProgress step={buildStep} progress={buildProgress} />
          ) : buildError === 'no-manifest' ? (
            <NoManifestMessage onRetry={getDriveToken() ? () => buildChecklist(getDriveToken()!) : undefined} />
          ) : buildError ? (
            <>
              <p className="text-amber-400 text-sm bg-amber-400/10 rounded-xl px-4 py-3">{buildError}</p>
              {getDriveToken() && (
                <button onClick={() => buildChecklist(getDriveToken()!)} className="text-pt-accent text-sm font-medium">
                  Try again
                </button>
              )}
            </>
          ) : (
            <p className="text-pt-muted text-sm">Connect Drive on the Videos screen, then return here.</p>
          )}
        </div>
      </div>
    )
  }

  if (!checklist) {
    return (
      <div className="min-h-screen bg-pt-bg">
        <Header title={folderName} onBack={() => navigate('/videos')} />
        <div className="p-6 text-center mt-10">
          <p className="text-pt-muted text-sm">No checklist built yet. Ask the owner to set this one up.</p>
        </div>
      </div>
    )
  }

  const props = checklist.props
  const byLane = {
    pull:           props.filter(p => getLane(p) === 'pull' && !p.removedFromScript),
    'buy-improvise': props.filter(p => getLane(p) === 'buy-improvise' && !p.removedFromScript),
    make:           props.filter(p => getLane(p) === 'make' && !p.removedFromScript),
    generate:       props.filter(p => getLane(p) === 'generate' && !p.removedFromScript),
    cut:            props.filter(p => getLane(p) === 'cut' || p.removedFromScript),
  }

  const pullItemIds: string[] = props
    .filter(p => (p.decision === 'confirmed' && p.matchedItemId) || (p.decision === 'alternative' && p.alternativeItemId))
    .map(p => p.decision === 'alternative' ? p.alternativeItemId! : p.matchedItemId!)

  return (
    <div className="min-h-screen bg-pt-bg pb-10">
      <Header
        title={checklist.videoTitle}
        onBack={() => navigate('/videos')}
        right={isOwner ? (
          <button
            onClick={handleResync}
            disabled={resyncing || building}
            className="text-pt-accent text-sm font-medium active:opacity-70 disabled:opacity-40"
          >
            {resyncing ? 'Syncing…' : 'Re-sync'}
          </button>
        ) : undefined}
      />

      <div className="p-4 space-y-4">

        {/* Parse warnings */}
        {parseWarnings.map((w, i) => (
          <p key={i} className="text-amber-400 text-sm bg-amber-400/10 rounded-xl px-4 py-2">{w}</p>
        ))}

        {/* Re-sync banner */}
        {resyncSummary && (
          <div className="bg-pt-accent/10 border border-pt-accent/30 rounded-2xl p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-pt-accent text-sm font-semibold">Manifest updated</p>
              <p className="text-pt-muted text-xs mt-0.5">
                {[
                  resyncSummary.addedCount > 0 && `${resyncSummary.addedCount} new prop${resyncSummary.addedCount !== 1 ? 's' : ''}`,
                  resyncSummary.removedCount > 0 && `${resyncSummary.removedCount} removed`,
                ].filter(Boolean).join(', ')}
              </p>
            </div>
            <button onClick={dismissResync} className="text-pt-muted text-xs active:opacity-70 shrink-0">Dismiss</button>
          </div>
        )}

        {/* Build error (during re-sync) */}
        {buildError && (
          <p className="text-amber-400 text-sm bg-amber-400/10 rounded-xl px-4 py-3">{buildError}</p>
        )}

        {/* Pull from Storage lane */}
        {byLane.pull.length > 0 && (
          <LaneSection
            title="Pull from Storage"
            count={byLane.pull.length}
            accentColor="text-green-400"
            footer={
              pullItemIds.length > 0 ? (
                <button
                  onClick={handleCheckout}
                  disabled={checkingOut || checkoutDone}
                  className="w-full py-3 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 text-sm font-semibold active:opacity-70 disabled:opacity-50"
                >
                  {checkoutDone
                    ? `Checked out ${pullItemIds.length} item${pullItemIds.length !== 1 ? 's' : ''} ✓`
                    : checkingOut
                      ? 'Checking out…'
                      : `Check Out ${pullItemIds.length} Item${pullItemIds.length !== 1 ? 's' : ''} for Shoot`
                  }
                </button>
              ) : null
            }
          >
            {byLane.pull.map(prop => (
              <PullPropCard
                key={prop.id}
                prop={prop}
                itemById={itemById}
                onConfirm={() => setPropDecision(prop.id, { decision: 'confirmed' })}
                onClearDecision={() => setPropDecision(prop.id, { decision: undefined, alternativeItemId: undefined, checked: false })}
                onCut={() => setPropDecision(prop.id, { decision: 'cut', checked: false })}
                onToggleCheck={() => toggleChecked(prop.id)}
              />
            ))}
          </LaneSection>
        )}

        {/* Buy / Improvise lane */}
        {byLane['buy-improvise'].length > 0 && (
          <LaneSection title="Buy / Improvise" count={byLane['buy-improvise'].length} accentColor="text-amber-400">
            {byLane['buy-improvise'].map(prop => (
              <BuyImprovisePropCard
                key={prop.id}
                prop={prop}
                itemById={itemById}
                onConfirm={() => setPropDecision(prop.id, { decision: 'confirmed' })}
                onReject={() => setPropDecision(prop.id, { decision: 'rejected' })}
                onBuy={() => setPropDecision(prop.id, { decision: 'buy', checked: false })}
                onMake={() => setPropDecision(prop.id, { decision: 'make', checked: false })}
                onCut={() => setPropDecision(prop.id, { decision: 'cut', checked: false })}
                onUseAlternative={itemId => setPropDecision(prop.id, { decision: 'alternative', alternativeItemId: itemId })}
                onToggleCheck={() => toggleChecked(prop.id)}
                onClearDecision={() => setPropDecision(prop.id, { decision: undefined, checked: false })}
              />
            ))}
          </LaneSection>
        )}

        {/* Make by Hand lane */}
        {byLane.make.length > 0 && (
          <LaneSection title="Make by Hand" count={byLane.make.length} accentColor="text-violet-400">
            {byLane.make.map(prop => (
              <SimplePropCard
                key={prop.id}
                prop={prop}
                onToggleCheck={() => toggleChecked(prop.id)}
                onCut={() => setPropDecision(prop.id, { decision: 'cut', checked: false })}
              />
            ))}
          </LaneSection>
        )}

        {/* Generate lane */}
        {byLane.generate.length > 0 && (
          <LaneSection title="Generate (AI)" count={byLane.generate.length} accentColor="text-sky-400">
            {byLane.generate.map(prop => (
              <AIPropCard
                key={prop.id}
                prop={prop}
                onToggleGenerated={() => setPropDecision(prop.id, { aiGenerated: !prop.aiGenerated })}
                onToggleCheck={() => toggleChecked(prop.id)}
                onCut={() => setPropDecision(prop.id, { decision: 'cut', checked: false })}
              />
            ))}
          </LaneSection>
        )}

        {/* Cut / Removed section (collapsed) */}
        {byLane.cut.length > 0 && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl overflow-hidden">
            <button
              onClick={() => setCutExpanded(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left active:opacity-70"
            >
              <span className="text-pt-muted text-sm font-medium">
                Cut from this video ({byLane.cut.length})
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-pt-muted transition-transform ${cutExpanded ? 'rotate-90' : ''}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </button>
            {cutExpanded && (
              <div className="border-t border-pt-border divide-y divide-pt-border">
                {byLane.cut.map(prop => (
                  <CutPropCard
                    key={prop.id}
                    prop={prop}
                    onUncut={() => setPropDecision(prop.id, { decision: undefined, removedFromScript: false })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {props.filter(p => !p.removedFromScript).length === 0 && !building && (
          <div className="text-center mt-10">
            <p className="text-pt-muted text-sm">No props in this checklist yet.</p>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Lane section wrapper ────────────────────────────────────────────────────

function LaneSection({
  title, count, accentColor, children, footer,
}: {
  title: string
  count: number
  accentColor: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-pt-border">
        <p className={`text-sm font-semibold ${accentColor}`}>{title}</p>
        <span className="text-pt-muted text-xs">{count} prop{count !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-pt-border">
        {children}
      </div>
      {footer && <div className="p-3 border-t border-pt-border">{footer}</div>}
    </div>
  )
}

// ─── Pull from Storage card ──────────────────────────────────────────────────

function PullPropCard({
  prop, itemById, onConfirm, onClearDecision, onCut, onToggleCheck,
}: {
  prop: VideoChecklistProp
  itemById: Map<string, Item>
  onConfirm: () => void
  onClearDecision: () => void
  onCut: () => void
  onToggleCheck: () => void
}) {
  const matchedItem = prop.matchedItemId ? itemById.get(prop.matchedItemId) : null
  const altItem     = prop.alternativeItemId ? itemById.get(prop.alternativeItemId) : null
  const displayItem = altItem ?? matchedItem
  const isConfirmed = prop.decision === 'confirmed' || prop.decision === 'alternative'

  return (
    <div className={`p-3 ${prop.checked ? 'opacity-60' : ''}`}>
      {prop.isNew && <NewBadge />}

      {/* Prop name row */}
      <div className="flex items-start gap-2 mb-2">
        <CheckCircle checked={prop.checked} onTap={onToggleCheck} />
        <div className="flex-1 min-w-0">
          <p className="text-pt-text text-sm font-medium leading-tight">
            {prop.name}
            {prop.qty > 1 && <span className="text-pt-muted"> ×{prop.qty}</span>}
          </p>
          {prop.scene && <p className="text-pt-muted text-xs">Scene: {prop.scene}</p>}
        </div>
      </div>

      {/* Matched / alternative item */}
      {displayItem && (
        <div className="ml-8 flex items-center gap-2 bg-pt-bg rounded-xl px-3 py-2 mb-2">
          <ItemThumb item={displayItem} />
          <div className="flex-1 min-w-0">
            <p className="text-pt-muted text-xs">
              {prop.decision === 'alternative' ? 'using instead:' : 'matched:'}
            </p>
            <p className="text-pt-text text-sm leading-tight truncate">{displayItem.name}</p>
          </div>
        </div>
      )}

      {/* Confidence-based action */}
      {!isConfirmed && prop.matchStatus === 'confident' && (
        <div className="ml-8 flex gap-2">
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-medium active:opacity-70"
          >
            Confirm — pull this
          </button>
          <button
            onClick={onCut}
            className="px-3 py-2 rounded-xl border border-pt-border text-pt-muted text-xs active:opacity-70"
          >
            Cut
          </button>
        </div>
      )}

      {/* Confirmed: allow undo */}
      {isConfirmed && (
        <button
          onClick={onClearDecision}
          className="ml-8 text-pt-muted text-xs active:opacity-70"
        >
          Remove from pull list
        </button>
      )}
    </div>
  )
}

// ─── Buy / Improvise card ────────────────────────────────────────────────────

function BuyImprovisePropCard({
  prop, itemById, onConfirm, onReject, onBuy, onMake, onCut, onUseAlternative, onToggleCheck, onClearDecision,
}: {
  prop: VideoChecklistProp
  itemById: Map<string, Item>
  onConfirm: () => void
  onReject: () => void
  onBuy: () => void
  onMake: () => void
  onCut: () => void
  onUseAlternative: (itemId: string) => void
  onToggleCheck: () => void
  onClearDecision: () => void
}) {
  const [altExpanded, setAltExpanded] = useState(false)
  const matchedItem = prop.matchedItemId ? itemById.get(prop.matchedItemId) : null
  const hasDecision = !!prop.decision && prop.decision !== 'rejected'
  const isPossible  = prop.matchStatus === 'possible' && !prop.decision

  return (
    <div className={`p-3 space-y-2 ${prop.checked ? 'opacity-60' : ''}`}>
      {prop.isNew && <NewBadge />}

      <div className="flex items-start gap-2">
        {hasDecision && <CheckCircle checked={prop.checked} onTap={onToggleCheck} />}
        <div className="flex-1 min-w-0">
          <p className="text-pt-text text-sm font-medium leading-tight">
            {prop.name}
            {prop.qty > 1 && <span className="text-pt-muted"> ×{prop.qty}</span>}
          </p>
          {prop.scene && <p className="text-pt-muted text-xs">Scene: {prop.scene}</p>}
          {prop.notes && <p className="text-pt-muted text-xs italic mt-0.5">{prop.notes}</p>}
          {hasDecision && (
            <span className={`inline-block text-xs mt-1 px-2 py-0.5 rounded-full ${
              prop.decision === 'buy'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-violet-500/20 text-violet-400'
            }`}>
              {prop.decision === 'buy' ? 'Buy it' : prop.decision === 'rejected' ? 'No match' : prop.decision}
            </span>
          )}
        </div>
      </div>

      {/* Possible match: "Is this the same thing?" */}
      {isPossible && matchedItem && (
        <div className="bg-pt-bg rounded-xl p-3 space-y-2">
          <p className="text-pt-muted text-xs font-medium">Is this the same thing?</p>
          <div className="flex items-center gap-2">
            <ItemThumb item={matchedItem} />
            <p className="text-pt-text text-sm flex-1 min-w-0 truncate">{matchedItem.name}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              className="flex-1 py-2 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-medium active:opacity-70"
            >
              Yes, use this
            </button>
            <button
              onClick={onReject}
              className="flex-1 py-2 rounded-xl bg-pt-border/30 border border-pt-border text-pt-muted text-xs active:opacity-70"
            >
              No, it's different
            </button>
          </div>
        </div>
      )}

      {/* Missing / rejected: alternatives + decision buttons */}
      {(!prop.decision || prop.decision === 'rejected') && prop.matchStatus !== 'possible' && (
        <>
          {/* Alternatives list */}
          {(prop.alternatives ?? []).length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => setAltExpanded(v => !v)}
                className="text-pt-accent text-xs font-medium flex items-center gap-1 active:opacity-70"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3 h-3 transition-transform ${altExpanded ? 'rotate-90' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                </svg>
                Closest things you own
              </button>
              {altExpanded && (
                <div className="space-y-1.5">
                  {(prop.alternatives ?? []).map(alt => {
                    const altItem = itemById.get(alt.itemId)
                    if (!altItem) return null
                    return (
                      <div key={alt.itemId} className="flex items-center gap-2 bg-pt-bg rounded-xl px-3 py-2">
                        <ItemThumb item={altItem} />
                        <div className="flex-1 min-w-0">
                          <p className="text-pt-text text-xs leading-tight truncate">{altItem.name}</p>
                        </div>
                        <button
                          onClick={() => onUseAlternative(altItem.id)}
                          className="text-xs bg-pt-accent/20 text-pt-accent px-2.5 py-1 rounded-lg active:opacity-70 shrink-0"
                        >
                          Use this
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Decision buttons */}
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={onBuy} className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-medium border border-amber-500/25 active:opacity-70">Buy it</button>
            <button onClick={onMake} className="px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-400 text-xs font-medium border border-violet-500/25 active:opacity-70">Make it</button>
            <button onClick={onCut} className="px-3 py-1.5 rounded-lg bg-pt-border/30 text-pt-muted text-xs border border-pt-border active:opacity-70">Cut</button>
          </div>
        </>
      )}

      {/* Already decided: allow changing */}
      {hasDecision && (
        <button
          onClick={onClearDecision}
          className="text-pt-muted text-xs active:opacity-70 ml-1"
        >
          Change decision
        </button>
      )}
    </div>
  )
}

// ─── Make by Hand card ───────────────────────────────────────────────────────

function SimplePropCard({
  prop, onToggleCheck, onCut,
}: {
  prop: VideoChecklistProp
  onToggleCheck: () => void
  onCut: () => void
}) {
  return (
    <div className={`p-3 flex items-start gap-2 ${prop.checked ? 'opacity-60' : ''}`}>
      <CheckCircle checked={prop.checked} onTap={onToggleCheck} />
      <div className="flex-1 min-w-0">
        {prop.isNew && <NewBadge />}
        <p className="text-pt-text text-sm font-medium leading-tight">
          {prop.name}
          {prop.qty > 1 && <span className="text-pt-muted"> ×{prop.qty}</span>}
        </p>
        {prop.scene && <p className="text-pt-muted text-xs">Scene: {prop.scene}</p>}
        {prop.notes && <p className="text-pt-muted text-xs italic mt-0.5">{prop.notes}</p>}
      </div>
      <button onClick={onCut} className="text-pt-muted text-xs active:opacity-70 shrink-0 pt-0.5">Cut</button>
    </div>
  )
}

// ─── AI / Generate card ──────────────────────────────────────────────────────

function AIPropCard({
  prop, onToggleGenerated, onToggleCheck, onCut,
}: {
  prop: VideoChecklistProp
  onToggleGenerated: () => void
  onToggleCheck: () => void
  onCut: () => void
}) {
  return (
    <div className={`p-3 flex items-start gap-2 ${prop.checked ? 'opacity-60' : ''}`}>
      <CheckCircle checked={prop.checked} onTap={onToggleCheck} />
      <div className="flex-1 min-w-0">
        {prop.isNew && <NewBadge />}
        <p className="text-pt-text text-sm font-medium leading-tight">
          {prop.name}
          {prop.qty > 1 && <span className="text-pt-muted"> ×{prop.qty}</span>}
        </p>
        {prop.scene && <p className="text-pt-muted text-xs">Scene: {prop.scene}</p>}
        {prop.notes && <p className="text-pt-muted text-xs italic mt-0.5">{prop.notes}</p>}
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <button
            onClick={onToggleGenerated}
            className={`text-xs px-2.5 py-0.5 rounded-full border active:opacity-70 ${
              prop.aiGenerated
                ? 'bg-sky-500/20 border-sky-500/30 text-sky-400'
                : 'border-pt-border text-pt-muted'
            }`}
          >
            {prop.aiGenerated ? 'Generated ✓' : 'Not yet generated'}
          </button>
          {prop.physical_output && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
              Print after
            </span>
          )}
        </div>
      </div>
      <button onClick={onCut} className="text-pt-muted text-xs active:opacity-70 shrink-0 pt-0.5">Cut</button>
    </div>
  )
}

// ─── Cut section card ────────────────────────────────────────────────────────

function CutPropCard({ prop, onUncut }: { prop: VideoChecklistProp; onUncut: () => void }) {
  return (
    <div className="px-4 py-3 flex items-center gap-2">
      <p className="text-pt-muted text-sm line-through flex-1 min-w-0 truncate">{prop.name}</p>
      {prop.removedFromScript && (
        <span className="text-xs bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full shrink-0">removed from script</span>
      )}
      <button
        onClick={onUncut}
        className="text-pt-accent text-xs active:opacity-70 shrink-0"
      >
        {prop.removedFromScript ? 'Keep' : 'Un-cut'}
      </button>
    </div>
  )
}

// ─── Small reusable pieces ───────────────────────────────────────────────────

function CheckCircle({ checked, onTap }: { checked: boolean; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors active:opacity-70 ${
        checked ? 'bg-green-500 border-green-500' : 'border-pt-border'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3.5 h-3.5 text-white">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      )}
    </button>
  )
}

function ItemThumb({ item }: { item: Item }) {
  return (
    <div className="w-10 h-10 rounded-lg bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
      {item.photoUrl
        ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-pt-muted">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
          </svg>
      }
    </div>
  )
}

function NewBadge() {
  return (
    <span className="inline-block text-xs bg-pt-accent/20 text-pt-accent px-1.5 py-0.5 rounded mb-1">new</span>
  )
}

function BuildProgress({ step, progress }: { step: string; progress: number }) {
  return (
    <div className="space-y-4 pt-4 px-2">
      <div className="w-full bg-pt-border rounded-full h-1 overflow-hidden">
        <div
          className="h-full bg-pt-accent rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-pt-muted text-sm text-center leading-relaxed min-h-[1.25rem] transition-opacity">
        {step}
      </p>
    </div>
  )
}

function NoManifestMessage({ onRetry }: { onRetry?: () => void }) {
  const [showFormat, setShowFormat] = useState(false)
  return (
    <div className="space-y-3 text-left">
      <p className="text-amber-400 text-sm bg-amber-400/10 rounded-xl px-4 py-3">
        No <code className="font-mono text-xs bg-amber-400/20 px-1 py-0.5 rounded">prop-manifest.txt</code> found in this Drive folder.
      </p>
      <p className="text-pt-muted text-sm">
        Create a file named <span className="font-mono text-xs text-pt-text bg-pt-surface px-1.5 py-0.5 rounded">prop-manifest.txt</span> inside this video's folder in Drive, then tap retry.
      </p>
      <button
        onClick={() => setShowFormat(v => !v)}
        className="text-pt-accent text-xs font-medium flex items-center gap-1 active:opacity-70"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 transition-transform ${showFormat ? 'rotate-90' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
        View expected format
      </button>
      {showFormat && (
        <pre className="text-xs text-pt-muted bg-pt-surface border border-pt-border rounded-xl px-3 py-3 overflow-x-auto leading-relaxed whitespace-pre">{`version: 1
title: My Video Title

prop: Red microphone
  type: physical
  qty: 1
  scene: Opening monologue

prop: Floating logo
  type: ai
  scene: Intro sequence
  physical_output: true

prop: Giant cardboard sword
  type: handmade
  qty: 2
  notes: Needs to look medieval`}</pre>
      )}
      {onRetry && (
        <button onClick={onRetry} className="text-pt-accent text-sm font-medium active:opacity-70">
          Retry
        </button>
      )}
    </div>
  )
}

function Header({
  title, onBack, right,
}: {
  title: string
  onBack: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border flex items-center gap-3">
      <button onClick={onBack} className="text-pt-muted active:opacity-70 shrink-0 py-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <h1 className="font-display text-xl text-pt-text flex-1 min-w-0 truncate py-2">{title}</h1>
      {right}
    </div>
  )
}
