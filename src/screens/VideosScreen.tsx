import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { OWNER_UID } from '../config'
import { requestDriveAccess, listFoldersIn, getDriveToken, DriveAuthError } from '../services/drive'
import { loadDriveConfig, saveDriveConfig } from '../services/driveConfig'
import type { DriveConfig } from '../services/driveConfig'
import { useVideoChecklists } from '../hooks/useVideoChecklists'
import type { DriveFolderMeta } from '../types'

interface PathEntry { id: string; name: string }

export default function VideosScreen() {
  const navigate   = useNavigate()
  const checklists = useVideoChecklists()
  const [uid, setUid] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, u => setUid(u?.uid ?? null))
  }, [])

  const isOwner = uid === OWNER_UID

  // Saved pipeline folder config (persisted in Firestore)
  const [driveConfig, setDriveConfig]   = useState<DriveConfig | null>(null)
  const [configLoaded, setConfigLoaded] = useState(false)

  // Drive state
  const [folders, setFolders]           = useState<DriveFolderMeta[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError]     = useState<string | null>(null)
  const [hasToken, setHasToken]         = useState(false)

  // Folder picker state
  const [pickerMode, setPickerMode]       = useState(false)
  const [pickerPath, setPickerPath]       = useState<PathEntry[]>([{ id: 'root', name: 'My Drive' }])
  const [pickerFolders, setPickerFolders] = useState<DriveFolderMeta[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSaving, setPickerSaving]   = useState(false)

  // On mount: check for existing token; load saved config from Firestore
  useEffect(() => {
    setHasToken(!!getDriveToken())
    if (!isOwner) { setConfigLoaded(true); return }
    loadDriveConfig()
      .then(cfg => { setDriveConfig(cfg); setConfigLoaded(true) })
      .catch(() => setConfigLoaded(true))
  }, [isOwner])

  // Auto-load video folders when we have both a token and a saved folder ID
  const pipelineFolderId = driveConfig?.pipelineFolderId
  useEffect(() => {
    if (isOwner && configLoaded && pipelineFolderId && hasToken) {
      const t = getDriveToken()
      if (t) loadVideoFolders(t, pipelineFolderId)
    }
  }, [isOwner, configLoaded, pipelineFolderId, hasToken])

  // ── Video folder loading ─────────────────────────────────────────────────

  async function loadVideoFolders(token: string, folderId: string) {
    setDriveLoading(true)
    setDriveError(null)
    try {
      setFolders(await listFoldersIn(token, folderId))
      setHasToken(true)
    } catch (err) {
      if (err instanceof DriveAuthError) {
        setHasToken(false)
        setFolders([])
        setDriveError('Drive access expired. Tap "Reconnect Drive" to refresh.')
      } else {
        setDriveError(err instanceof Error ? err.message : 'Failed to load videos from Drive.')
      }
    } finally {
      setDriveLoading(false)
    }
  }

  async function connectDrive() {
    setDriveLoading(true)
    setDriveError(null)
    try {
      const token = await requestDriveAccess()
      setHasToken(true)
      if (driveConfig) {
        await loadVideoFolders(token, driveConfig.pipelineFolderId)
      } else {
        // No folder configured yet — go straight to picker
        setDriveLoading(false)
        await enterPicker()
      }
    } catch (err) {
      if (err instanceof DriveAuthError) {
        setDriveError('Drive connection expired. Tap "Reconnect Drive" to try again.')
      } else if (err instanceof Error && err.message.toLowerCase().includes('popup')) {
        setDriveError('Popup was blocked or closed. Try again.')
      } else {
        setDriveError('Could not connect to Google Drive. Check your internet connection.')
      }
    } finally {
      setDriveLoading(false)
    }
  }

  // ── Folder picker ────────────────────────────────────────────────────────

  async function loadPickerFolders(parentId: string) {
    const t = getDriveToken()
    if (!t) return
    setPickerLoading(true)
    try {
      setPickerFolders(await listFoldersIn(t, parentId))
    } catch {
      setPickerFolders([])
    } finally {
      setPickerLoading(false)
    }
  }

  async function enterPicker() {
    setPickerPath([{ id: 'root', name: 'My Drive' }])
    setPickerMode(true)
    await loadPickerFolders('root')
  }

  async function pickerNavigate(folder: DriveFolderMeta) {
    const next = [...pickerPath, { id: folder.id, name: folder.name }]
    setPickerPath(next)
    await loadPickerFolders(folder.id)
  }

  async function pickerBack() {
    if (pickerPath.length <= 1) return
    const prev = pickerPath.slice(0, -1)
    setPickerPath(prev)
    await loadPickerFolders(prev[prev.length - 1].id)
  }

  async function selectPipelineFolder() {
    const current = pickerPath[pickerPath.length - 1]
    if (current.id === 'root') return
    setPickerSaving(true)
    try {
      const cfg: DriveConfig = { pipelineFolderId: current.id, pipelineFolderName: current.name }
      await saveDriveConfig(cfg)
      setDriveConfig(cfg)
      setPickerMode(false)
      const t = getDriveToken()
      if (t) await loadVideoFolders(t, current.id)
    } catch {
      setDriveError('Failed to save your folder selection.')
    } finally {
      setPickerSaving(false)
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const checklistById = useMemo(
    () => new Map(checklists.map(c => [c.id, c])),
    [checklists],
  )

  const shoppingCount = useMemo(
    () => checklists.reduce((sum, cl) => sum + cl.props.filter(p => p.decision === 'buy').length, 0),
    [checklists],
  )

  const unsavedFolders = folders.filter(f => !checklistById.has(f.id))

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">Videos</h1>
        <p className="text-pt-muted text-xs">Pre-production prop checklists</p>
      </div>

      <div className="p-4 space-y-4">

        {/* Shopping list quick-link */}
        {shoppingCount > 0 && (
          <button
            onClick={() => navigate('/shopping')}
            className="w-full flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 text-left active:opacity-75"
          >
            <div>
              <p className="text-amber-400 text-sm font-semibold">Shopping List</p>
              <p className="text-pt-muted text-xs mt-0.5">
                {shoppingCount} item{shoppingCount !== 1 ? 's' : ''} to buy
              </p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-amber-400 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Drive section — owner only */}
        {isOwner && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
            <p className="text-pt-muted text-xs uppercase tracking-wider">Google Drive</p>

            {driveError && (
              <p className="text-amber-400 text-sm bg-amber-400/10 rounded-xl px-3 py-2">{driveError}</p>
            )}

            {pickerMode ? (
              <FolderPicker
                path={pickerPath}
                folders={pickerFolders}
                loading={pickerLoading}
                saving={pickerSaving}
                canSelect={pickerPath.length > 1}
                onNavigate={pickerNavigate}
                onBack={pickerBack}
                onSelect={selectPipelineFolder}
                onCancel={() => setPickerMode(false)}
              />
            ) : !hasToken ? (
              <>
                <p className="text-pt-muted text-sm">
                  Connect your Google Drive to pull video folders and read prop manifests.
                </p>
                <button
                  onClick={connectDrive}
                  disabled={driveLoading}
                  className="flex items-center gap-2 bg-white text-gray-800 px-4 py-2.5 rounded-xl font-semibold text-sm shadow active:scale-95 transition-transform disabled:opacity-60"
                >
                  <GoogleIcon />
                  {driveLoading ? 'Connecting…' : 'Connect Google Drive'}
                </button>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-pt-muted text-sm">
                    {driveLoading
                      ? 'Loading folders…'
                      : driveConfig
                        ? `${driveConfig.pipelineFolderName} · ${folders.length} video${folders.length !== 1 ? 's' : ''}`
                        : 'No pipeline folder selected'
                    }
                  </span>
                  {!driveLoading && driveConfig && (
                    <button
                      onClick={() => { const t = getDriveToken(); if (t && driveConfig) loadVideoFolders(t, driveConfig.pipelineFolderId) }}
                      className="text-pt-accent text-sm font-medium active:opacity-70"
                    >
                      Refresh
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={enterPicker} className="text-pt-muted text-xs active:opacity-70">
                    {driveConfig ? 'Change folder' : 'Select pipeline folder'}
                  </button>
                  <span className="text-pt-border text-xs">·</span>
                  <button onClick={connectDrive} className="text-pt-muted text-xs active:opacity-70">
                    Reconnect Drive
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Saved checklists */}
        {checklists.length > 0 && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider px-1 mb-2">Saved checklists</p>
            <div className="space-y-2">
              {checklists.map(cl => (
                <VideoRow
                  key={cl.id}
                  title={cl.videoTitle}
                  subtitle={cl.driveFolderName}
                  badge={buildBadge(cl.props)}
                  onTap={() => navigate(`/videos/${cl.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Drive folders without a checklist yet */}
        {isOwner && hasToken && !pickerMode && unsavedFolders.length > 0 && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider px-1 mb-2">From Drive — no checklist yet</p>
            <div className="space-y-2">
              {unsavedFolders.map(f => (
                <VideoRow
                  key={f.id}
                  title={f.name}
                  subtitle="Tap to build checklist from manifest"
                  badge={null}
                  onTap={() => navigate(`/videos/${f.id}`, { state: { folderName: f.name } })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Non-owner empty state */}
        {!isOwner && checklists.length === 0 && (
          <div className="text-center mt-16">
            <p className="text-pt-muted text-sm leading-relaxed">
              No video checklists yet.<br />
              The owner will build one for each upcoming shoot.
            </p>
          </div>
        )}

        {!isOwner && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl p-4">
            <p className="text-pt-muted text-sm leading-relaxed">
              Checklists are built by the owner from Google Drive scripts. Once saved, you can use them here to see what to pull from storage and check things off.
            </p>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Folder Picker ───────────────────────────────────────────────────────────

interface FolderPickerProps {
  path: PathEntry[]
  folders: DriveFolderMeta[]
  loading: boolean
  saving: boolean
  canSelect: boolean
  onNavigate: (folder: DriveFolderMeta) => void
  onBack: () => void
  onSelect: () => void
  onCancel: () => void
}

function FolderPicker({ path, folders, loading, saving, canSelect, onNavigate, onBack, onSelect, onCancel }: FolderPickerProps) {
  const currentName = path[path.length - 1].name
  const canGoBack   = path.length > 1

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-pt-text text-sm font-medium">Select your video pipeline folder</p>
        <button onClick={onCancel} className="text-pt-muted text-xs active:opacity-70">Cancel</button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-pt-muted flex-wrap">
        {path.map((entry, i) => (
          <span key={entry.id} className="flex items-center gap-1">
            {i > 0 && <span className="opacity-40">/</span>}
            <span className={i === path.length - 1 ? 'text-pt-text font-medium' : ''}>{entry.name}</span>
          </span>
        ))}
      </div>

      {/* Folder list */}
      <div className="space-y-1 max-h-52 overflow-y-auto">
        {canGoBack && (
          <button
            onClick={onBack}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-pt-bg text-left active:opacity-70"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-pt-muted shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-pt-muted text-sm">Back</span>
          </button>
        )}

        {loading ? (
          <p className="text-pt-muted text-sm px-3 py-4 text-center">Loading…</p>
        ) : folders.length === 0 ? (
          <p className="text-pt-muted text-sm px-3 py-4 text-center">No subfolders here</p>
        ) : (
          folders.map(f => (
            <button
              key={f.id}
              onClick={() => onNavigate(f)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-pt-bg text-left active:opacity-70"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-pt-muted shrink-0">
                <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <span className="text-pt-text text-sm truncate flex-1">{f.name}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-pt-muted shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))
        )}
      </div>

      {/* Select button */}
      <button
        onClick={onSelect}
        disabled={!canSelect || saving || loading}
        className="w-full py-2.5 rounded-xl bg-pt-accent text-stone-900 font-semibold text-sm active:opacity-80 disabled:opacity-40"
      >
        {saving ? 'Saving…' : canSelect ? `Use "${currentName}"` : 'Navigate into a folder to select it'}
      </button>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildBadge(props: { type: string; checked: boolean; decision?: string }[]): string | null {
  const physical = props.filter(p => p.type === 'physical' && p.decision !== 'cut')
  const checked  = physical.filter(p => p.checked)
  if (physical.length === 0) return null
  return `${checked.length}/${physical.length} prepped`
}

interface VideoRowProps {
  title: string
  subtitle: string
  badge: string | null
  onTap: () => void
}

function VideoRow({ title, subtitle, badge, onTap }: VideoRowProps) {
  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3.5 text-left active:opacity-75 transition-opacity"
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-pt-text leading-tight truncate">{title}</p>
        <p className="text-pt-muted text-xs mt-0.5 truncate">{subtitle}</p>
      </div>
      {badge && (
        <span className="text-xs bg-pt-accent/20 text-pt-accent px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap">
          {badge}
        </span>
      )}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-pt-muted shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}
