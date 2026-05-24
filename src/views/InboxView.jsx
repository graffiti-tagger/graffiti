import React from 'react'
import { TopNav, StatusBar, Pill } from '../components/shell.jsx'
import AddToInbox from '../components/AddToInbox.jsx'

// ─── helpers ────────────────────────────────────────────────────────────────

const FMT_COLOR = { flac: 'green', mp3: 'cyan', ogg: 'yellow', m4a: 'pink', wav: 'pink', aiff: 'pink', aac: 'pink' }

async function* readSSEStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const blocks = buf.split('\n\n')
    buf = blocks.pop() ?? ''
    for (const block of blocks) {
      const line = block.split('\n').find(l => l.startsWith('data: '))
      if (line) {
        try { yield JSON.parse(line.slice(6)) } catch { /* skip malformed */ }
      }
    }
  }
}

// ─── Pipeline constants ───────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { id: 'integrity',   label: 'File integrity'  },
  { id: 'audio',       label: 'Audio stream'    },
  { id: 'fingerprint', label: 'Fingerprint'     },
  { id: 'acoustid',    label: 'AcoustID'        },
  { id: 'duplicate',   label: 'Duplicate check' },
  { id: 'musicbrainz', label: 'MusicBrainz'     },
  { id: 'tags',        label: 'Tag quality'     },
  { id: 'art',         label: 'Cover art'       },
]

const PHASE_COLOR = {
  idle: 'var(--ink-4)', running: 'var(--cyan)',
  'needs-review': 'var(--yellow)', done: 'var(--green)',
  tagged: 'var(--green)', 'rg-done': 'var(--cyan)',
  promoted: 'var(--ink-4)', error: 'var(--pink)',
}
const PHASE_LABEL = {
  idle: 'IDLE', running: '…', 'needs-review': 'REVIEW',
  done: 'DONE', tagged: 'TAGGED', 'rg-done': 'RG DONE',
  promoted: 'DONE', error: 'ERROR',
}
const STEP_ICON  = { pending: '·', running: '↻', ok: '✓', warn: '!', error: '✕' }
const STEP_COLOR = {
  pending: 'var(--ink-4)', running: 'var(--cyan)',
  ok: 'var(--green)', warn: 'var(--yellow)', error: 'var(--pink)',
}

function blankFileStatus() {
  return {
    phase: 'idle',
    steps: Object.fromEntries(PIPELINE_STEPS.map(s => [s.id, { status: 'pending', message: null }])),
    result: null,
  }
}

function countFiles(entries) {
  return entries.reduce((n, e) => n + (e.type === 'dir' ? countFiles(e.children ?? []) : 1), 0)
}

function collectAllFilePaths(entries) {
  const paths = []
  for (const e of entries) {
    if (e.type === 'file') paths.push(e.path)
    else paths.push(...collectAllFilePaths(e.children ?? []))
  }
  return paths
}

function groupByAlbum(paths) {
  const groups = new Map()
  for (const p of paths) {
    const dir = p.substring(0, p.lastIndexOf('/'))
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push(p)
  }
  return [...groups.entries()].map(([dir, trackPaths]) => ({
    dir,
    name: dir.split('/').pop() || dir,
    paths: trackPaths,
  }))
}

// ─── TreeRow ─────────────────────────────────────────────────────────────────

const TreeRow = ({ entry, depth, selected, onToggleFile, expanded, onToggleDir }) => {
  const indent = 12 + depth * 18

  if (entry.type === 'dir') {
    const isOpen = expanded.has(entry.path)
    const childFiles = collectAllFilePaths(entry.children ?? [])
    const allSelected = childFiles.length > 0 && childFiles.every(p => selected.has(p))
    const someSelected = !allSelected && childFiles.some(p => selected.has(p))

    return (
      <>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: `7px 12px 7px ${indent}px`,
            borderBottom: '1px solid var(--line-soft)',
            background: someSelected || allSelected ? 'color-mix(in oklch, var(--cyan) 6%, transparent)' : 'transparent',
            cursor: 'pointer', userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected }}
            onChange={() => childFiles.forEach(p => {
              if (allSelected || someSelected) onToggleFile(p, false)
              else onToggleFile(p, true)
            })}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: 'var(--cyan)', flex: '0 0 auto' }}
          />
          <span
            onClick={() => onToggleDir(entry.path)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <span style={{ fontSize: 10, color: 'var(--ink-4)', width: 10 }}>{isOpen ? '▼' : '▶'}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.name}
            </span>
            <span style={{ fontSize: 10, color: 'var(--ink-4)', flex: '0 0 auto' }}>{childFiles.length}</span>
          </span>
        </div>
        {isOpen && (entry.children ?? []).map(child => (
          <TreeRow
            key={child.path}
            entry={child}
            depth={depth + 1}
            selected={selected}
            onToggleFile={onToggleFile}
            expanded={expanded}
            onToggleDir={onToggleDir}
          />
        ))}
      </>
    )
  }

  const isSelected = selected.has(entry.path)
  return (
    <div
      onClick={() => onToggleFile(entry.path, !isSelected)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `6px 12px 6px ${indent}px`,
        borderBottom: '1px solid var(--line-soft)',
        borderLeft: `3px solid ${isSelected ? 'var(--cyan)' : 'transparent'}`,
        background: isSelected ? 'color-mix(in oklch, var(--cyan) 12%, transparent)' : 'transparent',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        onClick={e => e.stopPropagation()}
        style={{ accentColor: 'var(--cyan)', flex: '0 0 auto', pointerEvents: 'none' }}
      />
      <Pill accent={FMT_COLOR[entry.ext] ?? 'pink'}>{entry.ext?.toUpperCase()}</Pill>
      <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--f-mono)' }}>
        {entry.name}
      </span>
    </div>
  )
}

// ─── FileStatusRow ────────────────────────────────────────────────────────────

const FileStatusRow = ({ path: filePath, status: fs }) => {
  const filename = filePath.split('/').pop()
  const phaseColor = PHASE_COLOR[fs.phase] ?? 'var(--ink-4)'
  const activeSteps = PIPELINE_STEPS.filter(s => fs.steps[s.id].status !== 'pending')

  return (
    <div style={{ padding: '8px 16px 8px 28px', borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: activeSteps.length ? 5 : 0 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </span>
        <span style={{ fontSize: 10, color: phaseColor, fontWeight: 700, letterSpacing: '0.06em', flex: '0 0 auto' }}>
          {PHASE_LABEL[fs.phase] ?? fs.phase.toUpperCase()}
        </span>
      </div>
      {activeSteps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
          {activeSteps.map(step => {
            const s = fs.steps[step.id]
            return (
              <span key={step.id} style={{ fontSize: 10, display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <span style={{ color: STEP_COLOR[s.status] ?? 'var(--ink-4)', fontWeight: 700 }}>
                  {STEP_ICON[s.status] ?? '·'}
                </span>
                <span style={{ color: 'var(--ink-4)' }}>{step.label}</span>
                {s.message && (
                  <span style={{ color: s.status === 'error' ? 'var(--pink)' : s.status === 'warn' ? 'var(--yellow)' : 'var(--ink-5)' }}>
                    {s.message}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── ProcessPanel ────────────────────────────────────────────────────────────

const ProcessPanel = ({ selected, autoStartTrigger, onPromoted }) => {
  const [fileStatuses, setFileStatuses] = React.useState({})
  const [processing, setProcessing] = React.useState(false)
  const [reviewGroup, setReviewGroup] = React.useState(null)
  const [rgRunning, setRgRunning] = React.useState(new Set())
  const [promoteRunning, setPromoteRunning] = React.useState(new Set())

  React.useEffect(() => {
    setFileStatuses(prev => {
      const next = {}
      for (const p of selected) next[p] = prev[p] ?? blankFileStatus()
      return next
    })
  }, [selected])

  const patchFile = (filePath, patch) =>
    setFileStatuses(prev => ({ ...prev, [filePath]: { ...prev[filePath], ...patch } }))

  const patchStep = (filePath, stepId, stepPatch) =>
    setFileStatuses(prev => ({
      ...prev,
      [filePath]: {
        ...prev[filePath],
        steps: { ...prev[filePath].steps, [stepId]: { ...prev[filePath].steps[stepId], ...stepPatch } },
      },
    }))

  const startProcessing = React.useCallback(async (paths) => {
    if (processing || paths.length === 0) return
    setProcessing(true)

    setFileStatuses(prev => {
      const next = { ...prev }
      for (const p of paths) next[p] = { ...blankFileStatus(), phase: 'running' }
      return next
    })

    try {
      const res = await fetch('/api/inbox/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        for (const p of paths) patchFile(p, { phase: 'error' })
        console.error(err)
        return
      }

      for await (const event of readSSEStream(res)) {
        if (event.step) patchStep(event.path, event.step, { status: event.status, message: event.message ?? null })
        if (event.phase) patchFile(event.path, { phase: event.phase, result: event.result ?? null })
      }
    } catch {
      setFileStatuses(prev => {
        const next = { ...prev }
        for (const p of paths) {
          if (next[p]?.phase === 'running') next[p] = { ...next[p], phase: 'error' }
        }
        return next
      })
    } finally {
      setProcessing(false)
    }
  }, [processing])

  // Auto-start: fire when trigger counter increments (files added with auto-start on)
  const lastTrigger = React.useRef(0)
  const startProcessingRef = React.useRef(startProcessing)
  React.useEffect(() => { startProcessingRef.current = startProcessing }, [startProcessing])
  React.useEffect(() => {
    if (autoStartTrigger <= lastTrigger.current) return
    lastTrigger.current = autoStartTrigger
    const t = setTimeout(() => {
      const paths = [...selected].filter(p => {
        const st = fileStatuses[p]
        return !st || st.phase === 'idle'
      })
      if (paths.length > 0) startProcessingRef.current(paths)
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartTrigger])

  const runReplayGain = async (group) => {
    const taggedPaths = group.paths.filter(p => {
      const ph = fileStatuses[p]?.phase
      return ph === 'tagged' || ph === 'done'
    })
    if (taggedPaths.length === 0) return

    setRgRunning(prev => new Set([...prev, group.dir]))
    try {
      const res = await fetch('/api/inbox/replaygain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: taggedPaths }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        alert(`ReplayGain failed: ${e.error ?? res.status}`)
        return
      }
      for (const p of taggedPaths) patchFile(p, { phase: 'rg-done' })
    } finally {
      setRgRunning(prev => { const n = new Set(prev); n.delete(group.dir); return n })
    }
  }

  const promoteGroup = async (group) => {
    const rgPaths = group.paths.filter(p => fileStatuses[p]?.phase === 'rg-done')
    if (rgPaths.length === 0) return

    setPromoteRunning(prev => new Set([...prev, group.dir]))
    try {
      const res = await fetch('/api/inbox/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: rgPaths }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && data.promoted?.length === 0) {
        alert(`Promote failed: ${data.error ?? res.status}`)
        return
      }
      // Mark promoted files as removed
      for (const p of rgPaths) patchFile(p, { phase: 'promoted' })
      if (onPromoted) onPromoted(rgPaths)
    } finally {
      setPromoteRunning(prev => { const n = new Set(prev); n.delete(group.dir); return n })
    }
  }

  const albumGroups = React.useMemo(() => groupByAlbum([...selected]), [selected])

  if (selected.size === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--ink-4)' }}>
        <span style={{ fontSize: 32, opacity: 0.3 }}>▶</span>
        <span style={{ fontSize: 13 }}>Select files to process</span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ padding: '0 16px', height: 44, display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1.5px solid var(--line)', background: 'var(--bg-1)', flex: '0 0 auto' }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '0.04em', color: 'var(--ink-3)' }}>PROCESS</span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{selected.size} file{selected.size !== 1 ? 's' : ''} · {albumGroups.length} album{albumGroups.length !== 1 ? 's' : ''}</span>
        <span style={{ flex: 1 }} />
        <button
          className="btn primary sm"
          onClick={() => startProcessing([...selected].filter(p => (fileStatuses[p]?.phase ?? 'idle') === 'idle'))}
          disabled={processing}
          style={{ flex: '0 0 auto' }}
        >
          {processing ? '…' : '▶ Process'}
        </button>
      </div>

      {/* Album groups */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {albumGroups.map(group => {
          const phases = group.paths.map(p => fileStatuses[p]?.phase ?? 'idle')
          const allIdle     = phases.every(p => p === 'idle')
          const anyRunning  = phases.some(p => p === 'running')
          const anyReview   = phases.some(p => p === 'needs-review')
          const allFinished = phases.every(p => ['done', 'tagged', 'rg-done', 'promoted', 'error'].includes(p))
          const canReview   = !anyRunning && phases.some(p => ['needs-review', 'done'].includes(p))
          const allTagged   = phases.every(p => ['tagged', 'rg-done', 'done'].includes(p)) && allFinished
          const allRgDone   = phases.every(p => ['rg-done', 'promoted'].includes(p))
          const isRgRunning = rgRunning.has(group.dir)
          const isPromoting = promoteRunning.has(group.dir)

          return (
            <div key={group.dir} style={{ borderBottom: '1.5px solid var(--line)' }}>
              {/* Album header */}
              <div style={{ padding: '7px 16px', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{group.paths.length} tracks</span>
                {anyReview && <span style={{ fontSize: 10, color: 'var(--yellow)', fontWeight: 700 }}>REVIEW NEEDED</span>}
              </div>

              {/* Per-file rows */}
              {!allIdle && group.paths.map(p => (
                <FileStatusRow key={p} path={p} status={fileStatuses[p] ?? blankFileStatus()} />
              ))}

              {/* Group actions */}
              {(canReview || allTagged || allRgDone) && (
                <div style={{ padding: '8px 16px 10px', display: 'flex', gap: 8 }}>
                  {canReview && (
                    <button className="btn primary sm" onClick={() => setReviewGroup(group)}>
                      {anyReview ? 'Review Album…' : 'Apply Tags…'}
                    </button>
                  )}
                  {allTagged && !allRgDone && (
                    <button className="btn primary sm" onClick={() => runReplayGain(group)} disabled={isRgRunning}>
                      {isRgRunning ? '…' : 'Scan ReplayGain'}
                    </button>
                  )}
                  {allRgDone && (
                    <button className="btn primary sm" onClick={() => promoteGroup(group)} disabled={isPromoting}>
                      {isPromoting ? '…' : '→ Promote to Library'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {reviewGroup && (
        <AlbumReviewDialog
          group={reviewGroup}
          fileStatuses={fileStatuses}
          onAccepted={paths => {
            for (const p of paths) patchFile(p, { phase: 'tagged' })
            setReviewGroup(null)
          }}
          onClose={() => setReviewGroup(null)}
        />
      )}
    </div>
  )
}

// ─── AlbumReviewDialog ────────────────────────────────────────────────────────

const COUNTRY_NAMES = {
  GB: 'UK', US: 'US', DE: 'DE', FR: 'FR', JP: 'JP', AU: 'AU', CA: 'CA',
  XW: 'Worldwide', XE: 'Europe', XU: 'Universal',
}

const SHARED_FIELDS = [
  { key: 'albumartist', label: 'Album artist' },
  { key: 'artist',      label: 'Artist'       },
  { key: 'album',       label: 'Album'        },
  { key: 'date',        label: 'Year'         },
]

const AlbumReviewDialog = ({ group, fileStatuses, onAccepted, onClose }) => {
  const firstWithResult = group.paths.find(p => fileStatuses[p]?.result?.bestMatch)
  const masterResult = firstWithResult ? fileStatuses[firstWithResult]?.result : null
  const releases = masterResult?.bestMatch?.releases ?? []

  const [releaseIdx, setReleaseIdx] = React.useState(0)
  const [sharedTags, setSharedTags] = React.useState({})
  const [trackTags, setTrackTags] = React.useState({})
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    if (!masterResult?.bestMatch) return
    const mb = masterResult.bestMatch
    const rel = releases[releaseIdx] ?? {}
    setSharedTags({
      albumartist:          mb.artist ?? '',
      artist:               mb.artist ?? '',
      album:                rel.title ?? '',
      date:                 rel.date?.slice(0, 4) ?? '',
      musicbrainz_releaseid: rel.id ?? '',
      musicbrainz_artistid: mb.artistId ?? '',
    })
    const perTrack = {}
    for (const p of group.paths) {
      const res = fileStatuses[p]?.result
      const trackMb = res?.bestMatch
      if (!trackMb) {
        perTrack[p] = { title: '', tracknumber: '', discnumber: '', musicbrainz_recordingid: '' }
        continue
      }
      const matchRel = trackMb.releases.find(r => r.id === rel.id)
        ?? trackMb.releases[releaseIdx]
        ?? trackMb.releases[0]
      perTrack[p] = {
        title:                   trackMb.title ?? '',
        tracknumber:             matchRel?.trackNumber ?? '',
        discnumber:              (matchRel?.discNumber && matchRel?.discCount > 1) ? matchRel.discNumber : '',
        musicbrainz_recordingid: trackMb.id ?? '',
      }
    }
    setTrackTags(perTrack)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseIdx])

  const accept = async () => {
    setSaving(true)
    setError(null)
    try {
      for (const p of group.paths) {
        const tags = { ...sharedTags, ...(trackTags[p] ?? {}) }
        const res = await fetch('/api/inbox/apply-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p, tags }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(`${p.split('/').pop()}: ${e.error ?? `HTTP ${res.status}`}`)
        }
      }
      onAccepted(group.paths)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const pct = masterResult?.confidence != null ? Math.round(masterResult.confidence * 100) : null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'oklch(0 0 0 / 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-1)', border: '2px solid var(--line)', boxShadow: '4px 4px 0 var(--cyan)', width: 'min(94vw, 720px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em' }}>REVIEW ALBUM</span>
          {pct != null && (
            <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 85 ? 'var(--green)' : 'var(--yellow)', fontFamily: 'var(--f-mono)' }}>
              {pct}% confidence
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{group.name}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{group.paths.length} tracks</span>
          <button className="btn ghost" onClick={onClose} style={{ padding: '3px 8px', fontSize: 11, flex: '0 0 auto' }}>✕</button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {/* Release picker */}
          {releases.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Release ({releases.length} found)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {releases.map((rel, i) => {
                  const countryLabel = rel.country ? (COUNTRY_NAMES[rel.country] ?? rel.country) : null
                  return (
                    <div
                      key={rel.id}
                      onClick={() => setReleaseIdx(i)}
                      style={{
                        padding: '8px 10px', cursor: 'pointer', fontSize: 12,
                        background: releaseIdx === i ? 'color-mix(in oklch, var(--cyan) 12%, transparent)' : 'var(--bg-2)',
                        border: `1.5px solid ${releaseIdx === i ? 'var(--cyan)' : 'var(--line)'}`,
                        display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--ink-2)', flex: '1 1 160px' }}>{rel.title}</span>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto', fontSize: 11, color: 'var(--ink-4)' }}>
                        {rel.date && <span style={{ fontFamily: 'var(--f-mono)' }}>{rel.date.slice(0, 4)}</span>}
                        {countryLabel && <span>{countryLabel}</span>}
                        {rel.format && <span style={{ color: 'var(--ink-3)' }}>{rel.format}</span>}
                        {rel.totalTracks > 0 && <span>{rel.totalTracks} tracks</span>}
                        {rel.status && rel.status !== 'Official' && <span style={{ color: 'var(--yellow)' }}>{rel.status}</span>}
                        {rel.disambiguation && <span style={{ color: 'var(--cyan)', fontStyle: 'italic' }}>{rel.disambiguation}</span>}
                        <a
                          href={`https://musicbrainz.org/release/${rel.id}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'var(--ink-4)', textDecoration: 'none', fontSize: 10, opacity: 0.7 }}
                          title="Open on MusicBrainz"
                        >
                          MB↗
                        </a>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Shared album fields */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)' }}>
            <div className="label" style={{ marginBottom: 10 }}>Album fields</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SHARED_FIELDS.map(({ key, label }) => (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 10 }}>
                  <span className="label" style={{ margin: 0 }}>{label}</span>
                  <input
                    className="field"
                    value={sharedTags[key] ?? ''}
                    onChange={e => setSharedTags(t => ({ ...t, [key]: e.target.value }))}
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Per-track fields */}
          <div style={{ padding: '12px 16px' }}>
            <div className="label" style={{ marginBottom: 10 }}>Tracks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.paths.map(p => {
                const filename = p.split('/').pop()
                const tt = trackTags[p] ?? {}
                return (
                  <div key={p} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px 44px', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)', textAlign: 'right' }}>
                      {tt.tracknumber || '?'}
                    </span>
                    <input
                      className="field"
                      value={tt.title ?? ''}
                      onChange={e => setTrackTags(t => ({ ...t, [p]: { ...t[p], title: e.target.value } }))}
                      placeholder={filename}
                      style={{ fontSize: 12, padding: '3px 7px' }}
                    />
                    <input
                      className="field"
                      value={tt.tracknumber ?? ''}
                      onChange={e => setTrackTags(t => ({ ...t, [p]: { ...t[p], tracknumber: e.target.value } }))}
                      placeholder="Track #"
                      style={{ fontSize: 12, padding: '3px 7px' }}
                    />
                    <input
                      className="field"
                      value={tt.discnumber ?? ''}
                      onChange={e => setTrackTags(t => ({ ...t, [p]: { ...t[p], discnumber: e.target.value } }))}
                      placeholder="Disc"
                      style={{ fontSize: 12, padding: '3px 7px' }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          {error && <span style={{ fontSize: 11, color: 'var(--pink)', flex: 1, marginRight: 8 }}>{error}</span>}
          {!error && <span style={{ flex: 1 }} />}
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={accept} disabled={saving}>
            {saving ? '…' : `✓ Tag ${group.paths.length} track${group.paths.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AddMusicDialog ───────────────────────────────────────────────────────────

const AddMusicDialog = ({ onClose, onFilesAdded }) => (
  <div
    style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={onClose}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{ background: 'var(--bg-1)', border: '2px solid var(--line)', boxShadow: '4px 4px 0 var(--pink)', width: 'min(90vw, 580px)' }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em' }}>ADD MUSIC</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose} style={{ padding: '3px 8px', fontSize: 11 }}>✕ Close</button>
      </div>
      <AddToInbox onFilesAdded={files => { onFilesAdded(files) }} />
    </div>
  </div>
)

// ─── InboxView ────────────────────────────────────────────────────────────────

const InboxView = () => {
  const [entries, setEntries] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [expanded, setExpanded] = React.useState(new Set())
  const [selected, setSelected] = React.useState(new Set())
  const [addOpen, setAddOpen] = React.useState(false)
  const [clusterName, setClusterName] = React.useState('')
  const [clustering, setClustering] = React.useState(false)
  const [clusterError, setClusterError] = React.useState(null)
  const [autoStart, setAutoStart] = React.useState(true)
  const [autoStartTrigger, setAutoStartTrigger] = React.useState(0)

  React.useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(cfg => {
      setAutoStart(cfg.autoProcess ?? true)
    }).catch(() => {})
  }, [])

  const loadInbox = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/inbox').then(r => r.json())
      const loaded = data.entries ?? []
      setEntries(loaded)
      const dirs = new Set()
      const collectDirs = items => items.forEach(e => {
        if (e.type === 'dir') { dirs.add(e.path); collectDirs(e.children ?? []) }
      })
      collectDirs(loaded)
      setExpanded(dirs)
    } catch (e) {
      console.error('Failed to load inbox:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { loadInbox() }, [loadInbox])

  const toggleFile = (filePath, on) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(filePath); else next.delete(filePath)
      return next
    })
  }

  const toggleDir = dirPath => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath)
      return next
    })
  }

  const cluster = async () => {
    const name = clusterName.trim()
    if (!name || selected.size < 2) return
    setClustering(true)
    setClusterError(null)
    try {
      const res = await fetch('/api/inbox/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [...selected], folderName: name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setSelected(new Set())
      setClusterName('')
      await loadInbox()
    } catch (e) {
      setClusterError(e.message)
    } finally {
      setClustering(false)
    }
  }

  const handleFilesAdded = async (newFiles) => {
    await loadInbox()
    if (newFiles && newFiles.length > 0) {
      setSelected(prev => new Set([...prev, ...newFiles]))
      if (autoStart) setAutoStartTrigger(n => n + 1)
    }
  }

  const handlePromoted = async (paths) => {
    setSelected(prev => {
      const next = new Set(prev)
      paths.forEach(p => next.delete(p))
      return next
    })
    await loadInbox()
  }

  const totalFiles = countFiles(entries)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)' }}>
      <TopNav active="inbox" pendingCount={0} />

      {/* Main header */}
      <div style={{ padding: '0 16px', height: 44, display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1.5px solid var(--line)', background: 'var(--bg-1)', flex: '0 0 auto' }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em' }}>INBOX</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {loading ? 'Loading…' : `${totalFiles} file${totalFiles !== 1 ? 's' : ''}`}
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={autoStart}
            onChange={e => setAutoStart(e.target.checked)}
            style={{ accentColor: 'var(--cyan)' }}
          />
          Auto-start
        </label>
        <button
          className="btn primary sm"
          onClick={() => setAddOpen(true)}
          style={{ fontSize: 11, padding: '3px 10px' }}
        >
          + Add Music
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: file tree */}
        <div style={{ width: 380, flex: '0 0 380px', borderRight: '1.5px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--bg-1)' }}>
          {/* Left pane toolbar */}
          <div style={{ padding: '0 12px', height: 32, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line-soft)', flex: '0 0 auto' }}>
            <span style={{ fontSize: 10, color: 'var(--ink-4)', flex: 1 }}>{totalFiles} file{totalFiles !== 1 ? 's' : ''}</span>
            <span
              onClick={loading ? undefined : loadInbox}
              title="Refresh inbox"
              style={{ cursor: loading ? 'default' : 'pointer', fontSize: 16, color: loading ? 'var(--green)' : 'var(--ink-4)', lineHeight: 1, userSelect: 'none', animation: loading ? 'spin 1s linear infinite' : 'none' }}
            >↻</span>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            {!loading && entries.length === 0 && (
              <div style={{ padding: '32px 16px', color: 'var(--ink-4)', fontSize: 13, textAlign: 'center' }}>
                <div style={{ marginBottom: 8, fontSize: 24, opacity: 0.4 }}>♪</div>
                Inbox is empty
              </div>
            )}
            {entries.map(entry => (
              <TreeRow
                key={entry.path}
                entry={entry}
                depth={0}
                selected={selected}
                onToggleFile={toggleFile}
                expanded={expanded}
                onToggleDir={toggleDir}
              />
            ))}
          </div>

          {/* Cluster action bar */}
          {selected.size > 0 && (
            <div style={{ padding: '10px 12px', borderTop: '1.5px solid var(--line)', background: 'var(--bg-2)', flex: '0 0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: clusterError ? 6 : 0 }}>
                <span className="sticker cyan" style={{ fontSize: 10, flex: '0 0 auto' }}>{selected.size} selected</span>
                <input
                  className="field"
                  placeholder="Folder name to cluster into…"
                  value={clusterName}
                  onChange={e => { setClusterName(e.target.value); setClusterError(null) }}
                  onKeyDown={e => e.key === 'Enter' && cluster()}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
                />
                <button
                  className="btn primary sm"
                  onClick={cluster}
                  disabled={!clusterName.trim() || selected.size < 2 || clustering}
                  style={{ flex: '0 0 auto' }}
                >
                  {clustering ? '…' : 'Cluster'}
                </button>
                <span
                  onClick={() => { setSelected(new Set()); setClusterName(''); setClusterError(null) }}
                  style={{ cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)', lineHeight: 1, userSelect: 'none', flex: '0 0 auto' }}
                >✕</span>
              </div>
              {clusterError && (
                <div style={{ fontSize: 11, color: 'var(--pink)', marginTop: 4 }}>{clusterError}</div>
              )}
            </div>
          )}
        </div>

        {/* Right: process panel */}
        <div style={{ flex: 1, background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ProcessPanel
            selected={selected}
            autoStartTrigger={autoStart ? autoStartTrigger : 0}
            onPromoted={handlePromoted}
          />
        </div>
      </div>

      <StatusBar
        left={`${totalFiles} file${totalFiles !== 1 ? 's' : ''} in inbox${selected.size ? ` · ${selected.size} selected` : ''}`}
        right="Select files · Cluster into albums · Process"
      />

      {addOpen && (
        <AddMusicDialog
          onClose={() => setAddOpen(false)}
          onFilesAdded={handleFilesAdded}
        />
      )}
    </div>
  )
}

export default InboxView
