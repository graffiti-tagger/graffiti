import React from 'react'

// ─── SSE stream reader ────────────────────────────────────────────────────────

export async function* readSSEStream(response) {
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

export const PIPELINE_STEPS = [
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
const STEP_ICON  = { pending: '·', running: '↻', ok: '✓', warn: '!', error: '✕', skipped: '—' }
const STEP_COLOR = {
  pending: 'var(--ink-4)', running: 'var(--cyan)',
  ok: 'var(--green)', warn: 'var(--yellow)', error: 'var(--pink)', skipped: 'var(--ink-4)',
}

export function blankFileStatus() {
  return {
    phase: 'idle',
    steps: Object.fromEntries(PIPELINE_STEPS.map(s => [s.id, { status: 'pending', message: null }])),
    result: null,
  }
}

// Returns 0-100 health based on mandatory tag presence (mirrors backend computeHealth).
// REQUIRED_TAGS in the pipeline: title, artist, album, albumartist, tracknumber, date (6) + cover art = 7.
const MANDATORY_COUNT = 7
function computeTagHealth(result) {
  if (!result?.tagIssues) return null
  const missingText = result.tagIssues.length
  const artOk       = result.artPresent ? 1 : 0
  return Math.round(((6 - missingText) + artOk) / MANDATORY_COUNT * 100)
}

// Fallback: 0-100 from pipeline step statuses. null when nothing has started yet.
function computePipelineHealth(steps) {
  const all = PIPELINE_STEPS.map(s => steps[s.id])
  if (all.every(s => s.status === 'pending')) return null
  const score = all.reduce((sum, s) => {
    if (s.status === 'ok')   return sum + 1
    if (s.status === 'warn') return sum + 0.4
    return sum
  }, 0)
  return Math.round((score / all.length) * 100)
}

function healthColor(pct) {
  return pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--pink)'
}

export function groupByAlbum(paths) {
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

// ─── FileStatusRow ────────────────────────────────────────────────────────────

const FileStatusRow = ({ path: filePath, status: fs }) => {
  const filename = filePath.split('/').pop()
  const phaseColor = PHASE_COLOR[fs.phase] ?? 'var(--ink-4)'
  const activeSteps = PIPELINE_STEPS.filter(s => fs.steps[s.id].status !== 'pending')
  const health = computeTagHealth(fs.result) ?? computePipelineHealth(fs.steps)
  const hColor = health != null ? healthColor(health) : 'var(--ink-4)'
  const isActive = fs.phase !== 'idle' && fs.phase !== 'promoted'

  return (
    <div style={{ padding: '8px 16px 8px 28px', borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: activeSteps.length ? 5 : 0 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </span>
        {health != null ? (
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--f-mono)', color: hColor, flex: '0 0 auto', transition: 'color 0.4s ease', minWidth: 38, textAlign: 'right' }}>
            {health}%
          </span>
        ) : (
          <span style={{ fontSize: 10, color: phaseColor, fontWeight: 700, letterSpacing: '0.06em', flex: '0 0 auto' }}>
            {PHASE_LABEL[fs.phase] ?? fs.phase.toUpperCase()}
          </span>
        )}
      </div>
      {activeSteps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginBottom: isActive ? 6 : 0 }}>
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
      {isActive && health != null && (
        <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${health}%`,
            background: hColor,
            transition: 'width 0.5s ease, background 0.5s ease',
          }} />
        </div>
      )}
    </div>
  )
}

// ─── AlbumReviewDialog ────────────────────────────────────────────────────────

const COUNTRY_NAMES = { GB: 'UK', US: 'US', DE: 'DE', FR: 'FR', JP: 'JP', AU: 'AU', CA: 'CA', XW: 'Worldwide', XE: 'Europe', XU: 'Universal' }
const SHARED_FIELDS = [
  { key: 'albumartist', label: 'Album artist' },
  { key: 'artist',      label: 'Artist'       },
  { key: 'album',       label: 'Album'        },
  { key: 'date',        label: 'Year'         },
]
const TRACK_FIELDS = [
  { key: 'title',       label: 'Title'   },
  { key: 'tracknumber', label: 'Track #' },
  { key: 'discnumber',  label: 'Disc'    },
]

// applyTagsFn: async (path, tags) => void — defaults to POST /api/inbox/apply-tags
// persistPrefsFn: async (prefsToSet, prefsToClear) => void — optional, for persisting keep/accept decisions to DB
export const AlbumReviewDialog = ({ group, fileStatuses, onAccepted, onClose, applyTagsFn, persistPrefsFn }) => {
  const firstWithResult = group.paths.find(p => fileStatuses[p]?.result?.bestMatch)
  const masterResult = firstWithResult ? fileStatuses[firstWithResult]?.result : null
  const releases = masterResult?.bestMatch?.releases ?? []

  const [releaseIdx, setReleaseIdx] = React.useState(0)
  const [sharedTags, setSharedTags] = React.useState({})
  const [trackTags, setTrackTags] = React.useState({})
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [ignoredKeys, setIgnoredKeys] = React.useState(new Set())
  const [hasProposedRelease, setHasProposedRelease] = React.useState(() => !!masterResult?.bestMatch)

  const toggleIgnore = (k) => setIgnoredKeys(prev => {
    const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s
  })

  const firstExistingTags = fileStatuses[group.paths[0]]?.result?.existingTags ?? {}
  const [searchArtist, setSearchArtist] = React.useState(firstExistingTags.albumartist ?? firstExistingTags.artist ?? '')
  const [searchAlbum, setSearchAlbum] = React.useState(firstExistingTags.album ?? '')
  const [searchResults, setSearchResults] = React.useState(() => {
    for (const p of group.paths) {
      const c = fileStatuses[p]?.result?.mbSearchCandidates
      if (c?.length > 0) return c
    }
    return null
  })
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [tracklistLoading, setTracklistLoading] = React.useState(false)

  const runSearch = React.useCallback(async (artist, album) => {
    if (!artist && !album) return
    setSearchLoading(true)
    setSearchResults(null)
    try {
      const res = await fetch('/api/library/musicbrainz/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, album }),
      })
      const data = await res.json()
      setSearchResults(data.releases ?? [])
    } catch { setSearchResults([]) } finally { setSearchLoading(false) }
  }, [])

  const applySearchRelease = React.useCallback(async (rel) => {
    setTracklistLoading(true)
    setIgnoredKeys(new Set())
    try {
      const res = await fetch('/api/library/musicbrainz/release-tracklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseId: rel.id }),
      })
      const data = await res.json()
      if (data.error) return
      setSharedTags(prev => ({
        ...prev,
        albumartist:                data.artist || prev.albumartist,
        artist:                     data.artist || prev.artist,
        album:                      data.title  || prev.album,
        date:                       data.date?.slice(0, 4) || prev.date,
        musicbrainz_releaseid:      rel.id,
        musicbrainz_artistid:       data.artistId,
        musicbrainz_releasegroupid: data.releaseGroupId,
      }))
      const perTrack = {}
      group.paths.forEach((p, i) => {
        const track = data.tracks[i]
        const existing = fileStatuses[p]?.result?.existingTags ?? {}
        perTrack[p] = {
          title:                      track?.title   || existing.title      || '',
          tracknumber:                track?.number  || existing.tracknumber || '',
          discnumber:                 (track?.discCount > 1) ? String(track.discNumber) : existing.discnumber || '',
          musicbrainz_recordingid:    track?.recordingId  ?? '',
          musicbrainz_releasetrackid: track?.trackId      ?? '',
          acoustid_id:                fileStatuses[p]?.result?.acoustidMatches?.[0]?.acoustidId ?? '',
        }
      })
      setTrackTags(perTrack)
      setHasProposedRelease(true)
    } finally { setTracklistLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.paths, fileStatuses])

  React.useEffect(() => {
    const mb = masterResult?.bestMatch ?? null
    const rel = releases[releaseIdx] ?? {}
    const firstExisting = fileStatuses[group.paths[0]]?.result?.existingTags ?? {}
    const pick = (mbVal, existingVal) => mbVal || existingVal || ''

    setSharedTags({
      albumartist:                pick(mb?.artist,             firstExisting.albumartist),
      artist:                     pick(mb?.artist,             firstExisting.artist),
      album:                      pick(rel.title,              firstExisting.album),
      date:                       pick(rel.date?.slice(0, 4),  firstExisting.date),
      musicbrainz_releaseid:      rel.id ?? '',
      musicbrainz_artistid:       mb?.artistId ?? '',
      musicbrainz_releasegroupid: rel.releaseGroupId ?? '',
    })

    const perTrack = {}
    for (const p of group.paths) {
      const res = fileStatuses[p]?.result
      const trackMb = res?.bestMatch
      const existing = res?.existingTags ?? {}
      const matchRel = trackMb?.releases.find(r => r.id === rel.id)
                    ?? trackMb?.releases[releaseIdx]
                    ?? trackMb?.releases[0]
      perTrack[p] = {
        title:                      trackMb?.title        || existing.title       || '',
        tracknumber:                matchRel?.trackNumber  || existing.tracknumber || '',
        discnumber:                 (matchRel?.discNumber && matchRel?.discCount > 1)
                                      ? matchRel.discNumber
                                      : existing.discnumber || '',
        musicbrainz_recordingid:    trackMb?.id ?? '',
        musicbrainz_releasetrackid: matchRel?.releaseTrackId ?? '',
        acoustid_id:                res?.acoustidMatches?.[0]?.acoustidId ?? '',
      }
    }
    setTrackTags(perTrack)
    if (mb) setHasProposedRelease(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseIdx])

  const defaultApplyTags = async (p, tags) => {
    const res = await fetch('/api/inbox/apply-tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p, tags }),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      throw new Error(`${p.split('/').pop()}: ${e.error ?? `HTTP ${res.status}`}`)
    }
  }

  const accept = async () => {
    setSaving(true); setError(null)
    const applyFn = applyTagsFn ?? defaultApplyTags
    try {
      for (const p of group.paths) {
        const shared = Object.fromEntries(
          Object.entries(sharedTags).filter(([k]) => !ignoredKeys.has(k))
        )
        const perTrack = Object.fromEntries(
          Object.entries(trackTags[p] ?? {}).filter(([k]) => !ignoredKeys.has(`${p}:${k}`))
        )
        const tags = { ...shared, ...perTrack }
        await applyFn(p, tags)
      }
      if (persistPrefsFn) {
        const prefsToSet = [], prefsToClear = []
        for (const p of group.paths) {
          for (const { key } of SHARED_FIELDS) {
            ;(ignoredKeys.has(key) ? prefsToSet : prefsToClear).push({ path: p, tagKey: key })
          }
          for (const { key } of TRACK_FIELDS) {
            const k = `${p}:${key}`
            ;(ignoredKeys.has(k) ? prefsToSet : prefsToClear).push({ path: p, tagKey: key })
          }
        }
        await persistPrefsFn(prefsToSet, prefsToClear)
      }
      onAccepted(group.paths)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const pct = masterResult?.confidence != null ? Math.round(masterResult.confidence * 100) : null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'oklch(0 0 0 / 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-1)', border: '2px solid var(--line)', boxShadow: '4px 4px 0 var(--cyan)', width: 'min(96vw, 1200px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em' }}>
            {masterResult?.bestMatch ? 'REVIEW ALBUM' : 'TAG ALBUM'}
          </span>
          {pct != null && (
            <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 85 ? 'var(--green)' : 'var(--yellow)', fontFamily: 'var(--f-mono)' }}>{pct}% confidence</span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{group.name}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{group.paths.length} tracks</span>
          <button className="btn ghost" onClick={onClose} style={{ padding: '3px 8px', fontSize: 11, flex: '0 0 auto' }}>✕</button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {!masterResult?.bestMatch && (
            <div style={{ borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ padding: '8px 16px 6px', fontSize: 11, color: 'var(--yellow)' }}>
                No AcoustID match — search MusicBrainz to identify this release.
              </div>
              <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="field" value={searchArtist} onChange={e => setSearchArtist(e.target.value)}
                  placeholder="Artist" style={{ fontSize: 11, padding: '3px 7px', flex: 1 }}
                  onKeyDown={e => e.key === 'Enter' && runSearch(searchArtist, searchAlbum)} />
                <input className="field" value={searchAlbum} onChange={e => setSearchAlbum(e.target.value)}
                  placeholder="Album" style={{ fontSize: 11, padding: '3px 7px', flex: 2 }}
                  onKeyDown={e => e.key === 'Enter' && runSearch(searchArtist, searchAlbum)} />
                <button className="btn primary sm" onClick={() => runSearch(searchArtist, searchAlbum)} disabled={searchLoading || (!searchArtist && !searchAlbum)}>
                  {searchLoading ? '…' : 'Search'}
                </button>
              </div>
              {searchResults !== null && (
                <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {searchResults.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>No results.</div>
                  )}
                  {searchResults.map(rel => {
                    const countryLabel = rel.country ? (COUNTRY_NAMES[rel.country] ?? rel.country) : null
                    return (
                      <div key={rel.id} onClick={() => applySearchRelease(rel)} style={{
                        padding: '7px 10px', cursor: tracklistLoading ? 'wait' : 'pointer', fontSize: 12,
                        background: 'var(--bg-2)', border: '1.5px solid var(--line)',
                        display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center',
                        opacity: tracklistLoading ? 0.5 : 1,
                      }}>
                        <span style={{ fontWeight: 600, color: 'var(--ink-2)', flex: '1 1 160px' }}>
                          {rel.artist && rel.artist !== searchArtist && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>{rel.artist} — </span>}
                          {rel.title}
                        </span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto', fontSize: 11, color: 'var(--ink-4)' }}>
                          {rel.date && <span style={{ fontFamily: 'var(--f-mono)' }}>{rel.date.slice(0, 4)}</span>}
                          {countryLabel && <span>{countryLabel}</span>}
                          {rel.format && <span style={{ color: 'var(--ink-3)' }}>{rel.format}</span>}
                          {rel.totalTracks > 0 && <span>{rel.totalTracks} tracks</span>}
                          {rel.score != null && <span style={{ color: rel.score >= 80 ? 'var(--green)' : 'var(--yellow)' }}>{rel.score}%</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {releases.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Release ({releases.length} found)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {releases.map((rel, i) => {
                  const countryLabel = rel.country ? (COUNTRY_NAMES[rel.country] ?? rel.country) : null
                  return (
                    <div key={rel.id} onClick={() => setReleaseIdx(i)} style={{
                      padding: '8px 10px', cursor: 'pointer', fontSize: 12,
                      background: releaseIdx === i ? 'color-mix(in oklch, var(--cyan) 12%, transparent)' : 'var(--bg-2)',
                      border: `1.5px solid ${releaseIdx === i ? 'var(--cyan)' : 'var(--line)'}`,
                      display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center',
                    }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink-2)', flex: '1 1 160px' }}>{rel.title}</span>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto', fontSize: 11, color: 'var(--ink-4)' }}>
                        {rel.date && <span style={{ fontFamily: 'var(--f-mono)' }}>{rel.date.slice(0, 4)}</span>}
                        {countryLabel && <span>{countryLabel}</span>}
                        {rel.format && <span style={{ color: 'var(--ink-3)' }}>{rel.format}</span>}
                        {rel.totalTracks > 0 && <span>{rel.totalTracks} tracks</span>}
                        {rel.status && rel.status !== 'Official' && <span style={{ color: 'var(--yellow)' }}>{rel.status}</span>}
                        {rel.disambiguation && <span style={{ color: 'var(--cyan)', fontStyle: 'italic' }}>{rel.disambiguation}</span>}
                        <a href={`https://musicbrainz.org/release/${rel.id}`} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'var(--ink-4)', textDecoration: 'none', fontSize: 10, opacity: 0.7 }}
                          title="Open on MusicBrainz">MB↗</a>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)' }}>
            {hasProposedRelease ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 44px', gap: '2px 8px', marginBottom: 6 }}>
                  <span className="label" style={{ margin: 0 }}>Album fields</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>Current</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>MusicBrainz</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)', textAlign: 'center' }}>Keep</span>
                </div>
                {SHARED_FIELDS.map(({ key, label }) => {
                  const current  = firstExistingTags[key] ?? ''
                  const proposed = sharedTags[key] ?? ''
                  const differs  = proposed !== '' && proposed !== current
                  const kept     = ignoredKeys.has(key)
                  return (
                    <div key={key} style={{
                      display: 'grid', gridTemplateColumns: '110px 1fr 1fr 44px', gap: '2px 8px', alignItems: 'center',
                      padding: '5px 0',
                      background: differs && !kept ? 'color-mix(in oklch, var(--cyan) 8%, transparent)' : undefined,
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{label}</span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {current || <span style={{ opacity: 0.35 }}>—</span>}
                      </span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--f-mono)',
                        color: kept ? 'var(--ink-4)' : (differs ? 'var(--cyan)' : 'var(--ink-2)'),
                        opacity: kept ? 0.4 : 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {proposed || <span style={{ opacity: 0.35 }}>—</span>}
                      </span>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <input type="checkbox" checked={kept} disabled={!differs}
                          style={{ cursor: differs ? 'pointer' : 'default' }}
                          onChange={() => toggleIgnore(key)} />
                      </div>
                    </div>
                  )
                })}
              </>
            ) : (
              <>
                <div className="label" style={{ marginBottom: 10 }}>Album fields</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SHARED_FIELDS.map(({ key, label }) => {
                    const mbVal = key === 'album'  ? (releases[releaseIdx]?.title ?? '')
                                : key === 'date'   ? (releases[releaseIdx]?.date?.slice(0, 4) ?? '')
                                : (masterResult?.bestMatch?.artist ?? '')
                    const existing = firstExistingTags[key] ?? ''
                    const showDiff = mbVal && existing && mbVal !== existing
                    return (
                      <div key={key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'start', gap: 10 }}>
                        <span className="label" style={{ margin: 0, paddingTop: 6 }}>{label}</span>
                        <div>
                          <input className="field" value={sharedTags[key] ?? ''}
                            onChange={e => setSharedTags(t => ({ ...t, [key]: e.target.value }))}
                            style={{ fontSize: 12, padding: '4px 8px', width: '100%',
                              borderColor: showDiff ? 'var(--cyan)' : undefined }} />
                          {showDiff && (
                            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2, fontFamily: 'var(--f-mono)' }}>
                              file: {existing}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <div style={{ padding: '12px 16px' }}>
            {hasProposedRelease ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 44px', gap: '2px 8px', marginBottom: 4, paddingLeft: 16 }}>
                  <span className="label" style={{ margin: 0, paddingLeft: 0, gridColumn: '1 / -1' }}>Tracks</span>
                </div>
                {group.paths.map(p => {
                  const filename = p.split('/').pop()
                  const existing = fileStatuses[p]?.result?.existingTags ?? {}
                  const tt = trackTags[p] ?? {}
                  const diffs = TRACK_FIELDS.map(({ key, label }) => {
                    const current  = existing[key] ?? ''
                    const proposed = tt[key] ?? ''
                    return { key, label, current, proposed,
                      differs: proposed !== '' && proposed !== current,
                      kept: ignoredKeys.has(`${p}:${key}`),
                    }
                  }).filter(d => d.proposed !== '')
                  const hasDiff = diffs.some(d => d.differs && !d.kept)
                  return (
                    <div key={p} style={{ marginBottom: 6 }}>
                      <div style={{ padding: '3px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink-4)', minWidth: 20, textAlign: 'right' }}>
                          {tt.tracknumber || '?'}.
                        </span>
                        <span style={{ fontSize: 11, color: hasDiff ? 'var(--ink-2)' : 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {filename}
                        </span>
                        {!diffs.some(d => d.differs) && (
                          <span style={{ fontSize: 10, color: 'var(--ink-4)', opacity: 0.6 }}>· no changes</span>
                        )}
                      </div>
                      {diffs.map(d => (
                        <div key={d.key} style={{
                          display: 'grid', gridTemplateColumns: '80px 1fr 1fr 44px', gap: '2px 8px', alignItems: 'center',
                          paddingLeft: 28, padding: '3px 0 3px 28px',
                          background: d.differs && !d.kept ? 'color-mix(in oklch, var(--cyan) 8%, transparent)' : undefined,
                        }}>
                          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{d.label}</span>
                          <span style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.current || <span style={{ opacity: 0.35 }}>—</span>}
                          </span>
                          <span style={{ fontSize: 11, fontFamily: 'var(--f-mono)',
                            color: d.kept ? 'var(--ink-4)' : (d.differs ? 'var(--cyan)' : 'var(--ink-2)'),
                            opacity: d.kept ? 0.4 : 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.proposed || <span style={{ opacity: 0.35 }}>—</span>}
                          </span>
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <input type="checkbox" checked={d.kept} disabled={!d.differs}
                              style={{ cursor: d.differs ? 'pointer' : 'default' }}
                              onChange={() => toggleIgnore(`${p}:${d.key}`)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </>
            ) : (
              <>
                <div className="label" style={{ marginBottom: 10 }}>Tracks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {group.paths.map(p => {
                    const filename = p.split('/').pop()
                    const tt = trackTags[p] ?? {}
                    const existingTitle = fileStatuses[p]?.result?.existingTags?.title ?? ''
                    const mbTitle = fileStatuses[p]?.result?.bestMatch?.title ?? ''
                    const showDiff = mbTitle && existingTitle && mbTitle !== existingTitle
                    return (
                      <div key={p} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px 44px', gap: 8, alignItems: 'start' }}>
                        <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)', textAlign: 'right', paddingTop: 5 }}>{tt.tracknumber || '?'}</span>
                        <div>
                          <input className="field" value={tt.title ?? ''}
                            onChange={e => setTrackTags(t => ({ ...t, [p]: { ...t[p], title: e.target.value } }))}
                            placeholder={filename}
                            style={{ fontSize: 12, padding: '3px 7px', width: '100%',
                              borderColor: showDiff ? 'var(--cyan)' : undefined }} />
                          {showDiff && (
                            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2, fontFamily: 'var(--f-mono)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              file: {existingTitle}
                            </div>
                          )}
                        </div>
                        <input className="field" value={tt.tracknumber ?? ''}
                          onChange={e => setTrackTags(t => ({ ...t, [p]: { ...t[p], tracknumber: e.target.value } }))}
                          placeholder="Track #" style={{ fontSize: 12, padding: '3px 7px' }} />
                        <input className="field" value={tt.discnumber ?? ''}
                          onChange={e => setTrackTags(t => ({ ...t, [p]: { ...t[p], discnumber: e.target.value } }))}
                          placeholder="Disc" style={{ fontSize: 12, padding: '3px 7px' }} />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
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

// ─── ProcessPanel ─────────────────────────────────────────────────────────────
//
// Props:
//   selected           Set<string>  — file paths to process
//   endpoint           string       — SSE process endpoint (default: /api/inbox/process)
//   replaygainEndpoint string       — ReplayGain endpoint  (default: /api/inbox/replaygain)
//   mode               'inbox'|'fix' — 'fix' hides the Promote button
//   albumScope         boolean      — when false in fix mode, RG button is hidden with a note
//   showRgWarning      boolean      — show album RG warning (track-scope fix)
//   autoStartTrigger   number       — increment to auto-start processing
//   autoStart          boolean      — auto-start is active
//   onPromoted(paths)  function     — called after promote (inbox mode only)
//   onFixComplete(paths) function   — called when all tracks reach tagged/rg-done (fix mode)
//   applyTagsFn        async (path, tags) => void  — override tag-apply logic
//   persistPrefsFn     async (prefsToSet, prefsToClear) => void  — override pref persistence (defaults to library endpoint in fix mode)

const ProcessPanel = ({
  selected,
  endpoint = '/api/inbox/process',
  replaygainEndpoint = '/api/inbox/replaygain',
  mode = 'inbox',
  albumScope = true,
  showRgWarning = false,
  autoStartTrigger = 0,
  autoStart = false,
  onPromoted,
  onFixComplete,
  applyTagsFn,
  persistPrefsFn,
}) => {
  const [fileStatuses, setFileStatuses] = React.useState({})
  const [processing, setProcessing] = React.useState(false)
  const [reviewGroup, setReviewGroup] = React.useState(null)
  const [rgRunning, setRgRunning] = React.useState(new Set())
  const [promoteRunning, setPromoteRunning] = React.useState(new Set())
  const autoRgTriggered = React.useRef(new Set())

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
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok || !res.body) {
        for (const p of paths) patchFile(p, { phase: 'error' })
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
  }, [processing, endpoint])

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
    const qualifiedPaths = group.paths.filter(p => {
      const ph = fileStatuses[p]?.phase
      return ph === 'tagged' || ph === 'done'
    })
    if (qualifiedPaths.length === 0) return
    setRgRunning(prev => new Set([...prev, group.dir]))
    try {
      const res = await fetch(replaygainEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: qualifiedPaths }),
      })
      if (!res.ok) { alert(`ReplayGain failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`); return }
      for (const p of qualifiedPaths) patchFile(p, { phase: 'rg-done' })
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
      if (!res.ok && data.promoted?.length === 0) { alert(`Promote failed: ${data.error ?? res.status}`); return }
      for (const p of rgPaths) patchFile(p, { phase: 'promoted' })
      if (onPromoted) onPromoted(rgPaths)
    } finally {
      setPromoteRunning(prev => { const n = new Set(prev); n.delete(group.dir); return n })
    }
  }

  const albumGroups = React.useMemo(() => groupByAlbum([...selected]), [selected])

  // Auto-run ReplayGain when all tracks in a group are tagged and autoStart is on
  React.useEffect(() => {
    if (!autoStart) return
    for (const group of albumGroups) {
      if (autoRgTriggered.current.has(group.dir) || rgRunning.has(group.dir)) continue
      const phases = group.paths.map(p => fileStatuses[p]?.phase ?? 'idle')
      const allTaggedOrBetter = phases.length > 0 && phases.every(p => ['tagged', 'rg-done', 'promoted'].includes(p))
      const anyTagged = phases.some(p => p === 'tagged')
      if (allTaggedOrBetter && anyTagged && (mode === 'inbox' || albumScope)) {
        autoRgTriggered.current.add(group.dir)
        runReplayGain(group)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileStatuses, albumGroups, autoStart])

  // In fix mode, notify parent when all tracks reach a terminal state
  React.useEffect(() => {
    if (mode !== 'fix' || !onFixComplete) return
    const allPaths = [...selected]
    if (allPaths.length === 0) return
    const allDone = allPaths.every(p => {
      const ph = fileStatuses[p]?.phase ?? 'idle'
      return ['tagged', 'rg-done', 'error'].includes(ph)
    })
    if (allDone) onFixComplete(allPaths.filter(p => ['tagged', 'rg-done'].includes(fileStatuses[p]?.phase ?? '')))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileStatuses])

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
      {showRgWarning && (
        <div style={{ padding: '7px 16px', background: 'color-mix(in oklch, var(--yellow) 10%, transparent)', borderBottom: '1px solid var(--line-soft)', fontSize: 11, color: 'var(--yellow)' }}>
          ⚠ Album ReplayGain won't be recalculated in single-track mode. Open Fix at album level to correct album gain.
        </div>
      )}
      <div style={{ padding: '0 16px', height: 44, display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1.5px solid var(--line)', background: 'var(--bg-1)', flex: '0 0 auto' }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '0.04em', color: 'var(--ink-3)' }}>
          {mode === 'fix' ? 'FIX' : 'PROCESS'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{selected.size} file{selected.size !== 1 ? 's' : ''} · {albumGroups.length} album{albumGroups.length !== 1 ? 's' : ''}</span>
        <span style={{ flex: 1 }} />
        {!processing && [...selected].some(p => (fileStatuses[p]?.phase ?? 'idle') === 'idle') && (
          <button
            className="btn primary sm"
            onClick={() => startProcessing([...selected].filter(p => (fileStatuses[p]?.phase ?? 'idle') === 'idle'))}
          >
            ▶ {mode === 'fix' ? 'Analyse' : 'Process'}
          </button>
        )}
      </div>
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
          const showRg      = allTagged && !allRgDone && (mode === 'inbox' || albumScope)

          return (
            <div key={group.dir} style={{ borderBottom: '1.5px solid var(--line)' }}>
              <div style={{ padding: '7px 16px', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/^gt-inbox-/.test(group.name) ? '' : group.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{group.paths.length} tracks</span>
                {anyReview && <span style={{ fontSize: 10, color: 'var(--yellow)', fontWeight: 700 }}>REVIEW NEEDED</span>}
              </div>
              {!allIdle && group.paths.map(p => (
                <FileStatusRow key={p} path={p} status={fileStatuses[p] ?? blankFileStatus()} />
              ))}
              {(canReview || showRg || allRgDone) && (
                <div style={{ padding: '8px 16px 10px', display: 'flex', gap: 8 }}>
                  {canReview && (
                    <button className="btn primary sm" onClick={() => setReviewGroup(group)}>
                      {anyReview ? 'Review Album…' : 'Apply Tags…'}
                    </button>
                  )}
                  {showRg && (
                    <button className="btn primary sm" onClick={() => runReplayGain(group)} disabled={isRgRunning}>
                      {isRgRunning ? 'Running…' : 'Scan ReplayGain'}
                    </button>
                  )}
                  {allRgDone && mode === 'inbox' && (
                    <button className="btn primary sm" onClick={() => promoteGroup(group)} disabled={isPromoting}>
                      {isPromoting ? 'Promoting…' : '→ Promote to Library'}
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
          applyTagsFn={applyTagsFn}
          persistPrefsFn={persistPrefsFn ?? (mode === 'fix' ? async (prefsToSet, prefsToClear) => {
            await fetch('/api/library/musicbrainz/apply-tags', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ writes: [], prefsToSet, prefsToClear }),
            })
          } : null)}
          onAccepted={paths => {
            for (const p of paths) {
              const prev = fileStatuses[p]
              patchFile(p, {
                phase: 'tagged',
                result: prev?.result ? { ...prev.result, tagIssues: [] } : prev?.result,
              })
            }
            setReviewGroup(null)
          }}
          onClose={() => setReviewGroup(null)}
        />
      )}
    </div>
  )
}

export default ProcessPanel
