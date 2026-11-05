import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TopNav, StatusBar, Pill } from '../components/shell.jsx'
import { useIsMobile } from '../hooks/useBreakpoint.js'
import { TAGS, TAG_BY_KEY } from '../data/tags.js'
import { ID3_GENRES_SORTED } from '../data/id3genres.js'
import FixDialog from '../components/FixDialog.jsx'

const avgHealth = tracks => {
  const checked = tracks.filter(t => t.health !== null && t.health !== undefined)
  return checked.length > 0 ? Math.round(checked.reduce((s, t) => s + t.health, 0) / checked.length) : null
}

const MIN_PANEL = 220
const MAX_PANEL = 600

const SESSION_KEY = 'gt-library-state'
const LS_PANEL_KEY = 'gt-library-panel-width'

const LibraryTree = ({ onAddMusic }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [library, setLibrary] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [scanResult, setScanResult] = React.useState(null)

  const [open, setOpen] = React.useState({})
  const [sel, setSel] = React.useState(null)
  const [panelWidth, setPanelWidth] = React.useState(() => {
    const saved = parseInt(localStorage.getItem(LS_PANEL_KEY) ?? '')
    return isNaN(saved) ? 320 : Math.max(MIN_PANEL, Math.min(MAX_PANEL, saved))
  })
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [filterText, setFilterText] = React.useState("")
  const dragging = React.useRef(false)

  // Persist panel width
  React.useEffect(() => {
    localStorage.setItem(LS_PANEL_KEY, String(panelWidth))
  }, [panelWidth])

  // Persist selection + open state to sessionStorage
  React.useEffect(() => {
    if (!sel) return
    const openKeys = Object.entries(open).filter(([, v]) => v).map(([k]) => k)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sel, openKeys }))
  }, [sel, open])

  // Mirror selection into URL params so refresh restores it
  React.useEffect(() => {
    if (!sel) return
    const p = new URLSearchParams()
    p.set('artist', sel.artist)
    if (sel.album) p.set('album', sel.album)
    if (sel.kind === 'track' && sel.n != null) p.set('track', String(sel.n))
    const newSearch = '?' + p.toString()
    if (location.search !== newSearch) {
      navigate({ pathname: '/tree', search: newSearch }, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]) // intentionally narrow: navigate/location are stable refs

  const fetchTree = () => {
    setLoading(true)
    fetch('/api/library/tree')
      .then(async r => {
        const text = await r.text()
        if (!text) throw new Error('No response from server')
        return JSON.parse(text)
      })
      .then(data => setLibrary(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  React.useEffect(() => { fetchTree() }, [])

  React.useEffect(() => {
    const handler = () => fetchTree()
    window.addEventListener('gt:library-refresh', handler)
    return () => window.removeEventListener('gt:library-refresh', handler)
  }, [])

  // Restore state: URL params → sessionStorage → default first album
  React.useEffect(() => {
    if (!library.length) return

    const params = new URLSearchParams(location.search)
    const urlArtist = params.get('artist')
    const urlAlbum  = params.get('album')
    const urlTrack  = params.get('track')

    if (urlArtist) {
      const artistObj = library.find(a => a.artist === urlArtist)
      if (!artistObj) return
      if (!urlAlbum) {
        setOpen(o => ({ ...o, [urlArtist]: true }))
        setSel({ kind: 'artist', artist: urlArtist })
        return
      }
      const albumObj = artistObj.albums.find(al => al.name === urlAlbum)
      if (!albumObj) return
      setOpen(o => ({ ...o, [urlArtist]: true, [`${urlArtist}/${urlAlbum}`]: true }))
      if (urlTrack) {
        const n = parseInt(urlTrack)
        const track = albumObj.tracks.find(t => t.n === n)
        if (track) { setSel({ kind: 'track', artist: urlArtist, album: urlAlbum, n, title: track.title }); return }
      }
      setSel({ kind: 'album', artist: urlArtist, album: urlAlbum })
      return
    }

    // No URL params — try sessionStorage (navigated back from another tab)
    try {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (saved) {
        const { sel: savedSel, openKeys } = JSON.parse(saved)
        if (savedSel?.artist && library.find(a => a.artist === savedSel.artist)) {
          setOpen(o => ({ ...o, ...Object.fromEntries((openKeys ?? []).map(k => [k, true])) }))
          setSel(savedSel)
          return
        }
      }
    } catch { /* malformed session data — fall through */ }

    // Default: expand first artist + album
    const first = library[0]
    if (!first) return
    const firstAlbum = first.albums[0]
    setOpen(o => ({
      ...o,
      [first.artist]: true,
      ...(firstAlbum ? { [`${first.artist}/${firstAlbum.name}`]: true } : {}),
    }))
    if (firstAlbum) setSel({ kind: 'album', artist: first.artist, album: firstAlbum.name })
  }, [library, location.search])

  const scan = async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const r = await fetch('/api/library/scan', { method: 'POST' })
      const result = await r.json()
      setScanResult(result)
      fetchTree()
    } catch (e) {
      setScanResult({ error: e.message })
    } finally {
      setScanning(false)
    }
  }

  const onDividerMouseDown = e => {
    e.preventDefault()
    dragging.current = true
    const onMove = ev => {
      if (!dragging.current) return
      setPanelWidth(Math.min(MAX_PANEL, Math.max(MIN_PANEL, ev.clientX)))
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }))

  // Build flat row list from tree data
  const rows = []
  library.forEach(a => {
    const allTracks = a.albums.flatMap(al => al.tracks)
    const totalTracks = allTracks.length
    rows.push({ kind: "artist", artist: a.artist, depth: 0, count: totalTracks, albums: a.albums.length, health: avgHealth(allTracks) })
    if (open[a.artist]) {
      a.albums.forEach(al => {
        rows.push({ kind: "album", artist: a.artist, album: al.name, year: al.year, depth: 1, count: al.tracks.length, genre: al.genre, health: avgHealth(al.tracks), tracks: al.tracks })
        const albumKey = `${a.artist}/${al.name}`
        if (open[albumKey]) {
          al.tracks.forEach(t => {
            rows.push({ kind: "track", artist: a.artist, album: al.name, depth: 2, ...t })
          })
        }
      })
    }
  })

  const isSelected = r => {
    if (!sel || sel.kind !== r.kind) return false
    if (sel.kind === "artist") return sel.artist === r.artist
    if (sel.kind === "album") return sel.artist === r.artist && sel.album === r.album
    if (sel.kind === "track") return sel.artist === r.artist && sel.album === r.album && sel.n === r.n
    return false
  }

  const artistObj = sel ? library.find(a => a.artist === sel.artist) : null
  const albumObj  = artistObj && sel?.album ? artistObj.albums.find(al => al.name === sel.album) : null

  const statusLeft = scanResult
    ? scanResult.error
      ? `Scan error: ${scanResult.error}`
      : `Scan complete — ${scanResult.added} added, ${scanResult.updated} updated, ${scanResult.skipped} unchanged in ${(scanResult.durationMs / 1000).toFixed(1)}s`
    : sel
      ? `Selected: ${sel.kind} · ${sel.artist}${sel.album ? " / " + sel.album : ""}`
      : 'No selection'

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      <TopNav active="tree" pendingCount={0} onAddMusic={onAddMusic} />

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Tree panel — hidden on mobile when detail is showing */}
        {(!isMobile || !sel) && (
        <div style={{ width: isMobile ? '100%' : panelWidth, flex: isMobile ? 1 : `0 0 ${panelWidth}px`, display: "flex", flexDirection: "column", background: "var(--bg-1)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <span title={library.length ? "Your music library" : "No library scanned yet"} style={{ fontFamily: "var(--f-display)", fontSize: 14, letterSpacing: "0.04em", cursor: "default" }}>LIBRARY</span>
            <span style={{ flex: 1 }} />
            <span
              onClick={() => { setFilterOpen(o => !o); setFilterText("") }}
              title="Filter"
              style={{ cursor: "pointer", fontSize: 30, color: filterOpen ? "var(--green)" : "var(--ink-3)", lineHeight: 1, userSelect: "none" }}
            >⌕</span>
            <span
              onClick={scanning ? undefined : scan}
              title={scanning ? "Scanning…" : "Scan library folder"}
              style={{ cursor: scanning ? "default" : "pointer", fontSize: 18, color: scanning ? "var(--green)" : "var(--ink-3)", lineHeight: 1, userSelect: "none", animation: scanning ? "spin 1s linear infinite" : "none" }}
            >↻</span>
          </div>

          {filterOpen && (
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
              <input
                autoFocus
                className="field"
                placeholder="Filter artists, albums, tracks…"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                style={{ fontSize: 13, padding: "6px 10px" }}
              />
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", padding: "6px 0" }}>
            {loading && (
              <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 12 }}>Loading…</div>
            )}
            {!loading && library.length === 0 && (
              <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 12 }}>
                No tracks. Click ↻ to scan your library folder.
              </div>
            )}
            {rows.filter(r => {
              if (!filterText) return true
              const q = filterText.toLowerCase()
              return (r.artist || "").toLowerCase().includes(q)
                  || (r.album  || "").toLowerCase().includes(q)
                  || (r.title  || "").toLowerCase().includes(q)
            }).map((r, i) => {
              const active = isSelected(r)
              const key = r.kind === "artist" ? r.artist : r.kind === "album" ? `${r.artist}/${r.album}` : `${r.artist}/${r.album}/${r.n}`
              const isOpen = r.kind === "track" ? false : open[key]
              const onClick = () => setSel(
                r.kind === "track"
                  ? { kind: "track", artist: r.artist, album: r.album, n: r.n, title: r.title }
                  : r
              )
              return (
                <div key={i} onClick={onClick} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: `5px 12px 5px ${12 + r.depth * 10}px`,
                  background: active ? "color-mix(in oklch, var(--green) 14%, transparent)" : "transparent",
                  borderLeft: active ? "3px solid var(--green)" : "3px solid transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  color: r.kind === "track" ? "var(--ink-2)" : "var(--ink)",
                  fontWeight: r.kind === "artist" ? 700 : r.kind === "album" ? 600 : 400,
                }}>
                  {r.kind !== "track" ? (
                    <span onClick={e => { e.stopPropagation(); toggle(key) }} style={{ width: 22, color: "var(--ink-3)", fontSize: 20, lineHeight: 1, flexShrink: 0, marginRight: -8 }}>{isOpen ? "▾" : "▸"}</span>
                  ) : <span style={{ width: 20, color: "var(--ink-3)", fontSize: 13, flexShrink: 0 }}>♪</span>}
                  {r.kind === "track" && <span className="mono" style={{ color: "var(--ink-3)", fontSize: 11, width: 18, marginRight: -4 }}>{String(r.n).padStart(2, "0")}</span>}
                  <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.kind === "artist" ? r.artist : r.kind === "album" ? r.album : r.title}
                  </span>
                  {r.kind === "track" && <span className="mono" style={{ color: "var(--ink-3)", fontSize: 11 }}>{r.dur}</span>}
                  {r.kind === "album" && r.year && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                      fontFamily: "var(--f-mono)",
                      color: "var(--cyan)", border: "1px solid var(--cyan)",
                      padding: "1px 6px", display: "inline-block", flexShrink: 0,
                    }}>{r.year}</span>
                  )}
                  {r.kind === "artist" && <span className="mono" style={{ color: "var(--ink-4)", fontSize: 11 }}>{r.albums} · {r.count}</span>}
                  {r.kind === "album" && <span className="mono" style={{ color: "var(--ink-4)", fontSize: 11, minWidth: "2ch", textAlign: "right" }}>{r.count}</span>}
                </div>
              )
            })}
          </div>
        </div>
        )}

        {/* Resize handle — desktop only */}
        {!isMobile && (
          <div
            onMouseDown={onDividerMouseDown}
            style={{ width: 5, flex: "0 0 5px", background: "var(--line)", cursor: "col-resize", transition: "background 120ms" }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--green)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--line)"}
          />
        )}

        {/* Right pane — hidden on mobile when tree is showing */}
        {(!isMobile || sel) && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {isMobile && sel && (
              <button
                onClick={() => setSel(null)}
                style={{
                  padding: '10px 16px', textAlign: 'left',
                  background: 'var(--bg-1)', border: 'none',
                  borderBottom: '1.5px solid var(--line)',
                  color: 'var(--ink-2)', fontSize: 13, cursor: 'pointer',
                  flex: '0 0 auto',
                }}
              >← Library</button>
            )}
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              {sel
                ? <SelectionEditor
                    sel={sel}
                    artistObj={artistObj}
                    albumObj={albumObj}
                    onDeleted={() => { setSel(null); fetchTree() }}
                    onRefreshTree={fetchTree}
                  />
                : <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13 }}>Select an artist, album or track</div>
              }
            </div>
          </div>
        )}
      </div>

      <StatusBar left={statusLeft} right="Click ↻ to scan · Click a cell to edit" />
    </div>
  )
}

// Keys shown per selection level — labels come from the canonical tag schema
const FIELD_KEYS = {
  // Track-level: all 8 core fields in a sensible display order
  track:  ['title', 'artist', 'albumartist', 'album', 'tracknumber', 'discnumber', 'date', 'genre'],
  // Album-level bulk: per-track fields (title, tracknumber) excluded
  album:  ['albumartist', 'album', 'date', 'genre'],
  // Artist-level bulk: only artist identity fields
  artist: ['albumartist', 'artist'],
}

const SelectionEditor = ({ sel, artistObj, albumObj, onDeleted, onRefreshTree }) => {
  const isMobile = useIsMobile()
  const [vals, setVals] = React.useState({})
  const [origVals, setOrigVals] = React.useState({})
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState(null)
  const [artOpen, setArtOpen] = React.useState(false)
  const [artHover, setArtHover] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [rgState,       setRgState]       = React.useState({ running: false, error: null })
  const [acoustidState, setAcoustidState] = React.useState({ running: false, error: null })
  const [mbState,       setMbState]       = React.useState({ running: false, error: null })
  const [mbLookupResults,   setMbLookupResults]   = React.useState(null)
  const [mbDiffData,        setMbDiffData]         = React.useState(null)
  const [acoustidResultData, setAcoustidResultData] = React.useState(null)
  const [tagsRevision,   setTagsRevision]   = React.useState(0)
  const [libraryPath,    setLibraryPath]    = React.useState('')
  const [tagSettings,    setTagSettings]    = React.useState({})
  const [fixState,       setFixState]       = React.useState(null)

  React.useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(cfg => {
      setLibraryPath(cfg.libraryPath ?? '')
      setTagSettings(cfg.tagSettings ?? {})
    }).catch(() => {})
  }, [])

  React.useEffect(() => {
    setArtOpen(false)
    setRgState({ running: false, error: null })
    setAcoustidState({ running: false, error: null })
    setMbState({ running: false, error: null })
    setMbLookupResults(null)
    setMbDiffData(null)
    setAcoustidResultData(null)
  }, [sel.kind, sel.artist, sel.album, sel.n])

  const [extraKeys, setExtraKeys] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('gt:editor:extraFields') ?? '[]') } catch { return [] }
  })
  const [fieldMenu, setFieldMenu] = React.useState(false)
  const [customKey, setCustomKey] = React.useState('')
  React.useEffect(() => { localStorage.setItem('gt:editor:extraFields', JSON.stringify(extraKeys)) }, [extraKeys])
  const baseKeys = FIELD_KEYS[sel.kind] ?? []
  const shownExtras = extraKeys.filter(k => !baseKeys.includes(k))
  const toggleExtra = k => setExtraKeys(e => e.includes(k) ? e.filter(x => x !== k) : [...e, k])
  const addCustom = () => {
    const k = customKey.trim().toLowerCase()
    if (k && !baseKeys.includes(k) && !extraKeys.includes(k)) setExtraKeys(e => [...e, k])
    setCustomKey('')
  }
  const pickableTags = TAGS.filter(t => !t.readOnly && !baseKeys.includes(t.key) && t.key !== 'acoustid_fingerprint' && t.key !== 'lyrics')

  const fieldDefs = [...baseKeys, ...shownExtras]
    .filter(k => (tagSettings[k] ?? 'optional') !== 'ignored')
    .map(k => ({ key: k, label: TAG_BY_KEY[k]?.label ?? k }))

  React.useEffect(() => {
    setVals({})
    setOrigVals({})
    setSaveError(null)

    if (sel.kind === "track") {
      const track = albumObj?.tracks.find(t => t.n === sel.n)
      if (!track?.path) return
      setLoading(true)
      fetch(`/api/tags?path=${encodeURIComponent(track.path)}`)
        .then(r => r.json())
        .then(data => {
          const v = Object.fromEntries(fieldDefs.map(f => [f.key, data.tags?.[f.key] ?? '']))
          setVals(v)
          setOrigVals(v)
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    } else {
      const v = {
        ...Object.fromEntries(shownExtras.map(k => [k, ''])),
        ...(sel.kind === "artist"
          ? { albumartist: sel.artist, artist: sel.artist }
          : { album: sel.album, albumartist: sel.artist, date: albumObj?.year ?? '', genre: albumObj?.genre ?? '' }),
      }
      setVals(v)
      setOrigVals(v)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.kind, sel.artist, sel.album, sel.n, tagsRevision, shownExtras.join(',')])

  const changedTags = Object.fromEntries(
    Object.entries(vals).filter(([k]) => vals[k] !== origVals[k])
  )
  const dirty = Object.keys(changedTags).length > 0

  // Album art — use first FLAC track path as the art source
  const artSourcePath = React.useMemo(() => {
    const supported = t => t.fmt === 'FLAC' || t.fmt === 'MP3'
    if (sel.kind === 'track')  return albumObj?.tracks.find(t => t.n === sel.n && supported(t))?.path ?? null
    if (sel.kind === 'album')  return albumObj?.tracks.find(supported)?.path ?? null
    if (sel.kind === 'artist') return artistObj?.albums.flatMap(al => al.tracks).find(supported)?.path ?? null
    return null
  }, [sel, artistObj, albumObj])
  const artUrl = artSourcePath ? `/api/art?path=${encodeURIComponent(artSourcePath)}` : null
  const [artLoaded, setArtLoaded] = React.useState(false)
  const artImgRef = React.useRef(null)
  React.useEffect(() => {
    setArtLoaded(false)
    // If the browser already has this in cache, onLoad won't always fire reliably
    // for display:none elements — check complete after the next paint instead.
    if (!artUrl) return
    const check = () => {
      if (artImgRef.current?.complete && artImgRef.current?.naturalWidth > 0) {
        setArtLoaded(true)
      }
    }
    const raf = requestAnimationFrame(check)
    return () => cancelAnimationFrame(raf)
  }, [artUrl])

  // Genre dropdown only for formats with a constrained genre list (MP3/ID3)
  const selFmt = sel.kind === 'track'
    ? albumObj?.tracks.find(t => t.n === sel.n)?.fmt ?? null
    : sel.kind === 'album' && albumObj?.tracks.length > 0 && albumObj.tracks.every(t => t.fmt === albumObj.tracks[0].fmt)
      ? albumObj.tracks[0].fmt
      : null
  const isId3 = selFmt === 'MP3'

  const affectedPaths = React.useMemo(() => {
    if (sel.kind === "track") return [albumObj?.tracks.find(t => t.n === sel.n)?.path].filter(Boolean)
    if (sel.kind === "album")  return albumObj?.tracks.map(t => t.path).filter(Boolean) ?? []
    if (sel.kind === "artist") return artistObj?.albums.flatMap(al => al.tracks.map(t => t.path)).filter(Boolean) ?? []
    return []
  }, [sel, artistObj, albumObj])

  const save = async () => {
    if (!dirty || affectedPaths.length === 0) return
    setSaving(true)
    setSaveError(null)
    const results = await Promise.allSettled(
      affectedPaths.map(path =>
        fetch(`/api/tags?path=${encodeURIComponent(path)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changedTags),
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`) })
      )
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === 0) setOrigVals({ ...vals })
    else setSaveError(`${failed} file(s) failed to save`)
    setSaving(false)
  }

  const revert = () => setVals({ ...origVals })

  const refetchMusicBrainz = async () => {
    if (affectedPaths.length === 0) return
    setMbState({ running: true, error: null })
    try {
      const res = await fetch('/api/library/musicbrainz/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: affectedPaths }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setMbState({ running: false, error: null })
      setMbLookupResults(data)
    } catch (e) {
      setMbState({ running: false, error: e.message })
    }
  }

  const selHealth = React.useMemo(() => {
    if (sel.kind === 'track') {
      const t = albumObj?.tracks.find(t => t.n === sel.n)
      return t?.health ?? null
    }
    const allTracks = sel.kind === 'album'
      ? (albumObj?.tracks ?? [])
      : (artistObj?.albums.flatMap(al => al.tracks) ?? [])
    const checked = allTracks.filter(t => t.health !== null && t.health !== undefined)
    return checked.length > 0 ? Math.round(checked.reduce((s, t) => s + t.health, 0) / checked.length) : null
  }, [sel, artistObj, albumObj])

  const openDiff = async (releaseId) => {
    setMbState({ running: true, error: null })
    try {
      const assignments = (mbLookupResults?.perPath ?? [])
        .filter(r => r.recordingId && r.acoustidId)
        .map(r => ({ path: r.path, acoustidId: r.acoustidId, recordingId: r.recordingId, artistId: r.artistId }))
      const res = await fetch('/api/library/musicbrainz/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: affectedPaths, releaseId, assignments }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setMbState({ running: false, error: null })
      setMbDiffData({ ...data, releaseId })
    } catch (e) {
      setMbState({ running: false, error: e.message })
    }
  }

  const applyDiffTags = async (keeps) => {
    const writes = []
    const prefsToSet = []
    const prefsToClear = []

    const allPaths = new Set([
      ...(mbDiffData?.tracks ?? []).map(t => t.path),
      ...(mbDiffData?.identifiers ?? []).map(i => i.path),
    ])
    for (const filePath of allPaths) {
      const track = (mbDiffData?.tracks ?? []).find(t => t.path === filePath)
      const ident = (mbDiffData?.identifiers ?? []).find(i => i.path === filePath)
      const tagWrites = {}
      for (const diff of track?.diffs ?? []) {
        const keepKey = `${filePath}:${diff.key}`
        if (keeps[keepKey]) {
          prefsToSet.push({ path: filePath, tagKey: diff.key })
        } else {
          tagWrites[diff.key] = diff.proposed
          prefsToClear.push({ path: filePath, tagKey: diff.key })
        }
      }
      if (ident) Object.assign(tagWrites, ident.tags)
      if (Object.keys(tagWrites).length > 0) writes.push({ path: filePath, tags: tagWrites })
    }

    setMbState({ running: true, error: null })
    setMbDiffData(null)
    setMbLookupResults(null)
    try {
      const res = await fetch('/api/library/musicbrainz/apply-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes, prefsToSet, prefsToClear }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setMbState({ running: false, error: null })
      // (removed)
      onRefreshTree()
      setTagsRevision(r => r + 1)
      // Backfill AcoustID in the background: submit fingerprints with recording IDs,
      // then re-lookup to write acoustid_id tags. fetchTagStatus on completion turns the border green.
      const recordingIds = {}
      for (const w of writes) {
        if (w.tags?.musicbrainz_recordingid && !w.tags?.acoustid_id) recordingIds[w.path] = w.tags.musicbrainz_recordingid
      }
      const submitPaths = Object.keys(recordingIds)
      if (submitPaths.length > 0) {
        fetch('/api/library/acoustid-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: submitPaths, recordingIds }),
        })
          .catch(() => {})
      }
    } catch (e) {
      setMbState({ running: false, error: e.message })
    }
  }

  const total = artistObj?.albums.reduce((s, a) => s + a.tracks.length, 0) ?? 0
  const scopeNote = sel.kind === "artist"
    ? `Will update ${total} tracks across ${artistObj?.albums.length ?? 0} albums`
    : sel.kind === "album"
      ? `Will update ${albumObj?.tracks.length ?? 0} tracks`
      : albumObj?.tracks.find(t => t.n === sel.n)?.title || "(unknown)"

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: isMobile ? "12px 14px" : "20px 28px", borderBottom: "1.5px solid var(--line)", background: "var(--bg-1)", position: "relative" }}>
        <div className="concrete" style={{ position: "absolute", inset: 0, opacity: 0.25, pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 18 }}>
          <div
            onClick={() => albumObj && setArtOpen(true)}
            onMouseEnter={() => albumObj && setArtHover(true)}
            onMouseLeave={() => setArtHover(false)}
            title={albumObj ? "Manage album art" : undefined}
            style={{ width: isMobile ? 60 : 96, height: isMobile ? 60 : 96, flex: "0 0 auto", border: "1.5px solid var(--ink)", position: "relative", overflow: "hidden", background: "linear-gradient(135deg, oklch(0.32 0.08 350), oklch(0.15 0.02 270))", cursor: albumObj ? "pointer" : "default" }}
          >
            {artUrl && (
              <img
                ref={artImgRef}
                src={artUrl}
                onLoad={() => setArtLoaded(true)}
                onError={() => setArtLoaded(false)}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                alt=""
              />
            )}
            {!artLoaded && (
              <>
                <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg, transparent 0 8px, oklch(0 0 0 / 0.4) 8px 10px)" }} />
                <div style={{ position: "absolute", inset: 8, top: "30%", fontFamily: "var(--f-marker)", fontSize: 18, lineHeight: 0.9, color: "var(--green)", textShadow: "1px 1px 0 oklch(0 0 0)", transform: "rotate(-3deg)" }}>
                  {(sel.album || sel.artist || "").toUpperCase()}
                </div>
              </>
            )}
            {artHover && albumObj && (
              <div style={{ position: "absolute", inset: 0, background: "oklch(0 0 0 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "white" }}>✎</div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
              {sel.kind === "artist" ? "Album Artist" : sel.kind === "album" ? `${sel.artist} · Album` : `${sel.artist} · ${sel.album}`}
            </div>
            <h1 style={{ margin: "6px 0 4px", fontFamily: "var(--f-display)", fontSize: isMobile ? 22 : 36, lineHeight: 1, letterSpacing: "0.005em" }}>
              {(sel.kind === "artist" ? sel.artist : sel.kind === "album" ? sel.album : (sel.title || "Track")).toUpperCase()}
            </h1>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{scopeNote}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            {selHealth !== null ? (
              <div
                onClick={() => affectedPaths.length > 0 && setFixState({
                  paths: affectedPaths,
                  scope: sel.kind === 'track' ? 'track' : 'album',
                  albumName: sel.album || sel.artist,
                })}
                title="Click to run Fix pipeline"
                style={{ cursor: affectedPaths.length > 0 ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}
              >
                <div style={{
                  fontFamily: 'var(--f-display)', lineHeight: 1, letterSpacing: '-0.02em',
                  color: selHealth >= 90 ? 'var(--green)' : selHealth >= 60 ? 'var(--yellow)' : 'var(--pink)',
                }}>
                  <span style={{ fontSize: isMobile ? 26 : 40 }}>{selHealth}</span><span style={{ fontSize: isMobile ? 14 : 20, opacity: 0.7 }}>%</span>
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  health · click to fix
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)' }}>—</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "12px 14px" : "20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span className="sticker green" style={{ fontSize: 11 }}>{sel.kind === "track" ? "TRACK · WRITE" : "BULK · WRITE"}</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {loading ? "Loading tags…" : dirty ? `${Object.keys(changedTags).length} field(s) changed` : "No pending changes"}
          </span>
          <span style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <button className="btn sm" onClick={() => setFieldMenu(m => !m)}>▦ Fields ({fieldDefs.length})</button>
            {fieldMenu && (
              <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 10, background: "var(--bg-2)", border: "1.5px solid var(--green)", boxShadow: "4px 4px 0 var(--pink)", padding: 12, width: 240, marginTop: 4 }}>
                <div className="label" style={{ marginBottom: 8 }}>Additional fields</div>
                <div style={{ maxHeight: 240, overflow: "auto" }}>
                  {pickableTags.map(t => (
                    <label key={t.key} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={extraKeys.includes(t.key)} onChange={() => toggleExtra(t.key)} style={{ accentColor: "var(--green)" }} />
                      {t.label}
                    </label>
                  ))}
                  {extraKeys.filter(k => !TAG_BY_KEY[k]).map(k => (
                    <label key={k} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked onChange={() => toggleExtra(k)} style={{ accentColor: "var(--green)" }} />
                      {k}
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <input className="field" placeholder="custom tag name" value={customKey}
                    onChange={e => setCustomKey(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustom()} />
                  <button className="btn sm" onClick={addCustom}>Add</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 720 }}>
          {fieldDefs.map(f => {
            const isDirty = vals[f.key] !== origVals[f.key]
            return (
              <div key={f.key} style={{ gridColumn: f.wide ? "1 / -1" : "auto" }}>
                <div className="label" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{f.label}</span>
                  {isDirty && <span style={{ color: "var(--pink)", fontSize: 10 }}>● PENDING</span>}
                </div>
                {f.key === 'genre' && isId3
                  ? <select
                      className="field"
                      value={vals[f.key] ?? ''}
                      onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                      disabled={loading}
                      style={isDirty ? { borderColor: "var(--pink)", boxShadow: "inset 3px 0 0 var(--pink)" } : null}
                    >
                      <option value="">—</option>
                      {ID3_GENRES_SORTED.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  : <input
                      className="field"
                      value={vals[f.key] ?? ''}
                      onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                      disabled={loading}
                      style={isDirty ? { borderColor: "var(--pink)", boxShadow: "inset 3px 0 0 var(--pink)" } : null}
                    />
                }
                {f.hint && <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>{f.hint}</div>}
              </div>
            )
          })}
        </div>

        {sel.kind === "track" && (() => {
          const fullPath = albumObj?.tracks.find(t => t.n === sel.n)?.path ?? ''
          const relPath = libraryPath && fullPath.startsWith(libraryPath)
            ? fullPath.slice(libraryPath.length).replace(/^\//, '')
            : fullPath
          return relPath ? (
            <div style={{ marginTop: 18, maxWidth: 720 }}>
              <div className="label">File path</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", padding: "7px 10px", background: "var(--bg-2)", border: "1px solid var(--line)", wordBreak: "break-all" }}>
                {relPath}
              </div>
            </div>
          ) : null
        })()}

        {sel.kind === "album" && albumObj && (
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px dashed var(--line)" }}>
            <div className="label" style={{ marginBottom: 10 }}>Tracks in this album ({albumObj.tracks.length})</div>
            <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 60px 60px", fontSize: 13 }}>
              {albumObj.tracks.map(t => (
                <React.Fragment key={t.n}>
                  <div className="mono" style={{ color: "var(--ink-4)", padding: "5px 0" }}>{String(t.n).padStart(2, "0")}</div>
                  <div style={{ padding: "5px 0", color: "var(--ink-2)" }}>{t.title}</div>
                  <div className="mono" style={{ color: "var(--ink-4)", padding: "5px 0", fontSize: 11 }}>{t.fmt}</div>
                  <div className="mono" style={{ color: "var(--ink-3)", padding: "5px 0", fontSize: 11 }}>{t.dur}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "12px 28px", borderTop: "1.5px solid var(--line)", background: "var(--bg-2)", display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
        {saveError && (
          <span style={{ fontSize: 12, color: "var(--pink)" }}>{saveError}</span>
        )}
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          Changes apply to <span style={{ color: "var(--ink)", fontWeight: 600 }}>
            {sel.kind === "artist" ? "all tracks by this artist" : sel.kind === "album" ? "all tracks in this album" : "this track"}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          style={{ color: "var(--pink)", borderColor: "var(--pink)" }}
          onClick={() => setDeleteOpen(true)}
        >
          Delete…
        </button>
        <button className="btn" onClick={refetchMusicBrainz} disabled={mbState.running || affectedPaths.length === 0} title="Look up this selection on MusicBrainz and re-apply tags">
          {mbState.running ? "Fetching…" : "Refetch from MusicBrainz"}
        </button>
        <button className="btn" onClick={revert} disabled={!dirty || saving}>Revert</button>
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {artOpen && albumObj && (
        <ArtDialog albumObj={albumObj} onClose={() => setArtOpen(false)} />
      )}
      {mbLookupResults && !mbDiffData && (
        <MBPickerDialog
          results={mbLookupResults}
          artist={sel.artist}
          album={sel.album}
          onReviewTags={openDiff}
          onClose={() => setMbLookupResults(null)}
        />
      )}
      {mbDiffData && (
        <MBDiffDialog
          data={mbDiffData}
          onClose={() => { setMbDiffData(null); setMbLookupResults(null) }}
          onChangePicker={() => setMbDiffData(null)}
          onApply={applyDiffTags}
        />
      )}
      {acoustidResultData && (
        <AcoustIDResultDialog
          data={acoustidResultData}
          onClose={() => setAcoustidResultData(null)}
          onSubmitDone={(submitted) => setAcoustidResultData(d => ({ ...d, submitted, unmatchedPaths: [] }))}
          onSearchMusicBrainz={() => {
            setAcoustidResultData(null)
            setMbLookupResults({ perPath: [], releases: [], totalPaths: affectedPaths.length })
          }}
        />
      )}
      {(acoustidState.error || mbState.error || rgState.error) && (
        <ScanErrorDialog
          error={acoustidState.error || mbState.error || rgState.error}
          onClose={() => {
            if (acoustidState.error) setAcoustidState(s => ({ ...s, error: null }))
            if (mbState.error) setMbState(s => ({ ...s, error: null }))
            if (rgState.error) setRgState(s => ({ ...s, error: null }))
          }}
        />
      )}
      {fixState && (
        <FixDialog
          paths={fixState.paths}
          scope={fixState.scope}
          albumName={fixState.albumName}
          onClose={() => { setFixState(null); onRefreshTree() }}
        />
      )}
      {deleteOpen && (
        <DeleteConfirmDialog
          sel={sel}
          paths={affectedPaths}
          onDeleted={onDeleted}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}

export default LibraryTree

const DeleteConfirmDialog = ({ sel, paths, onDeleted, onClose }) => {
  const [confirmed, setConfirmed] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState(null)

  const scopeLabel =
    sel.kind === "artist" ? `all tracks by ${sel.artist}` :
    sel.kind === "album"  ? `all tracks in ${sel.album}` :
    `"${sel.title || sel.album}"`

  const doDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && (!data.deleted || data.deleted.length === 0)) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      onDeleted()
    } catch (e) {
      setError(e.message)
      setDeleting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'oklch(0 0 0 / 0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-1)', border: '2px solid var(--pink)', boxShadow: '4px 4px 0 var(--pink)', width: 'min(90vw, 480px)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em', color: 'var(--pink)' }}>DELETE FROM LIBRARY</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ padding: '3px 8px', fontSize: 11 }}>✕</button>
        </div>

        <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            You are about to permanently delete <strong>{scopeLabel}</strong> — {paths.length} file{paths.length !== 1 ? 's' : ''} — from disk and remove them from the library.
          </div>

          <div style={{ padding: '10px 12px', background: 'color-mix(in oklch, var(--pink) 10%, transparent)', border: '1px solid var(--pink)', fontSize: 12, color: 'var(--pink)', lineHeight: 1.5 }}>
            This cannot be undone. Files will be deleted from disk.
          </div>

          <div style={{ maxHeight: 160, overflow: 'auto', background: 'var(--bg-0)', border: '1px solid var(--line)', padding: '8px 10px' }}>
            {paths.map(p => (
              <div key={p} style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '2px 0' }}>
                {p}
              </div>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ accentColor: 'var(--pink)' }}
            />
            Yes, I understand this will permanently delete {paths.length} file{paths.length !== 1 ? 's' : ''} from disk
          </label>

          {error && <div style={{ fontSize: 12, color: 'var(--pink)' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1.5px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={deleting}>Cancel</button>
          <button
            className="btn"
            style={{ background: confirmed && !deleting ? 'var(--pink)' : undefined, color: confirmed && !deleting ? 'oklch(0.15 0 0)' : 'var(--pink)', borderColor: 'var(--pink)', opacity: !confirmed || deleting ? 0.5 : 1 }}
            onClick={doDelete}
            disabled={!confirmed || deleting}
          >
            {deleting ? 'Deleting…' : `Delete ${paths.length} file${paths.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const ScanErrorDialog = ({ error, onClose }) => (
  <div
    style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={onClose}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{ background: 'var(--bg-1)', border: '2px solid var(--pink)', width: 'min(92vw, 480px)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em', color: 'var(--pink)' }}>SCAN ERROR</div>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{error}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>
)

const AcoustIDResultDialog = ({ data, onClose, onSubmitDone, onSearchMusicBrainz }) => {
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState(null)
  const [submitted, setSubmitted] = React.useState(data.submitted ?? 0)
  const unmatchedPaths = data.unmatchedPaths ?? []
  const didSubmit = submitted > 0

  const doSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/library/acoustid-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: unmatchedPaths }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`)
      const n = result.submitted ?? unmatchedPaths.length
      setSubmitted(n)
      onSubmitDone(n)
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-1)', border: '2px solid var(--cyan)', width: 'min(92vw, 520px)', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em', color: 'var(--cyan)' }}>ACOUSTID SCAN RESULTS</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" style={{ fontSize: 13, padding: '2px 8px' }} onClick={onClose}>✕</button>
        </div>

        {/* Summary */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, marginBottom: 6 }}>
            <span style={{ color: 'var(--green)' }}>⌗</span>{' '}
            {data.matched} of {data.total} track{data.total !== 1 ? 's' : ''} identified
          </div>
          {unmatchedPaths.length > 0 && !didSubmit && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              {unmatchedPaths.length} track{unmatchedPaths.length !== 1 ? 's were' : ' was'} not found in AcoustID.
              Search MusicBrainz by artist and album to identify them — fingerprints will be submitted to AcoustID automatically once a release is applied.
            </div>
          )}
          {didSubmit && (
            <div style={{ fontSize: 13, color: 'var(--cyan)', lineHeight: 1.5 }}>
              {submitted} fingerprint{submitted !== 1 ? 's' : ''} submitted to AcoustID.
              Submissions are reviewed by the community and may take time to appear. Re-scan later to pick up matches.
            </div>
          )}
        </div>

        {/* Unmatched track list */}
        {unmatchedPaths.length > 0 && !didSubmit && (
          <div style={{ maxHeight: 200, overflowY: 'auto', borderBottom: '1px solid var(--line)' }}>
            {unmatchedPaths.map(p => (
              <div key={p} style={{ padding: '6px 20px', fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '1px solid var(--line-soft)' }}>
                {p.split('/').pop()}
              </div>
            ))}
          </div>
        )}

        {submitError && (
          <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--pink)', borderBottom: '1px solid var(--line)' }}>
            {submitError}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {unmatchedPaths.length > 0 && !didSubmit && data.hasUserKey && (
            <button
              className="btn ghost"
              onClick={doSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : `Submit ${unmatchedPaths.length} fingerprint${unmatchedPaths.length !== 1 ? 's' : ''}`}
            </button>
          )}
          {unmatchedPaths.length > 0 && (
            <button
              className="btn ghost"
              style={{ color: 'var(--cyan)', borderColor: 'var(--cyan)' }}
              onClick={onSearchMusicBrainz}
            >
              Search MusicBrainz →
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            {didSubmit ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

const mbMatchScore = (rel, totalPaths) => {
  if (!totalPaths) return 0
  const diff = Math.abs((rel.totalTracks ?? 0) - totalPaths)
  const trackScore = Math.max(0, 1 - diff / Math.max(rel.totalTracks ?? 0, totalPaths))
  const fpScore = (rel.matchCount ?? 0) / totalPaths
  return Math.round((trackScore * 0.7 + fpScore * 0.3) * 100)
}

const MBReleaseTable = ({ releases, selectedId, onSelect, totalPaths }) => (
  <div style={{ overflowY: 'auto', flex: 1 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-4)', fontSize: 11 }}>
          <th style={{ padding: '8px 12px', textAlign: 'left', width: 24 }} />
          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Title</th>
          <th style={{ padding: '8px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>Date</th>
          <th style={{ padding: '8px 8px', textAlign: 'left' }}>Country</th>
          <th style={{ padding: '8px 8px', textAlign: 'left' }}>Format</th>
          <th style={{ padding: '8px 8px', textAlign: 'left' }}>Status</th>
          <th style={{ padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>Tracks</th>
          <th style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>Match</th>
        </tr>
      </thead>
      <tbody>
        {releases.map(rel => {
          const isSelected = rel.id === selectedId
          const relTracks = rel.totalTracks ?? 0
          const diff = relTracks - totalPaths
          const trackColor = diff === 0 ? 'var(--green)' : Math.abs(diff) <= 2 ? 'var(--yellow, #e6a817)' : 'var(--ink-3)'
          const score = mbMatchScore(rel, totalPaths)
          const scoreColor = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow, #e6a817)' : 'var(--ink-3)'
          return (
            <tr
              key={rel.id}
              onClick={() => onSelect(rel.id)}
              style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', background: isSelected ? 'oklch(0.82 0.18 210 / 0.12)' : 'transparent' }}
            >
              <td style={{ padding: '10px 12px' }}>
                <input type="radio" readOnly checked={isSelected} style={{ accentColor: 'var(--cyan)', cursor: 'pointer' }} />
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>
                <span style={{ fontWeight: isSelected ? 600 : 400 }}>{rel.title}</span>
                {rel.disambiguation && <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>({rel.disambiguation})</span>}
              </td>
              <td style={{ padding: '10px 8px', color: 'var(--ink-3)', fontFamily: 'var(--f-mono)', whiteSpace: 'nowrap' }}>{rel.date?.slice(0, 4) || '—'}</td>
              <td style={{ padding: '10px 8px', color: 'var(--ink-3)', fontFamily: 'var(--f-mono)' }}>{rel.country || '—'}</td>
              <td style={{ padding: '10px 8px', color: 'var(--ink-3)' }}>{rel.format || '—'}</td>
              <td style={{ padding: '10px 8px', color: rel.status === 'Official' ? 'var(--green)' : 'var(--ink-3)' }}>{rel.status || '—'}</td>
              <td style={{ padding: '10px 8px', textAlign: 'right', color: trackColor, fontFamily: 'var(--f-mono)', whiteSpace: 'nowrap' }}>
                {relTracks || '—'}
                {relTracks > 0 && diff !== 0 && <span style={{ fontSize: 10, marginLeft: 3 }}>{diff > 0 ? `+${diff}` : diff}</span>}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', color: scoreColor, fontFamily: 'var(--f-mono)', fontWeight: 600 }}>
                {score}%
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

const MBDiffDialog = ({ data, onClose, onChangePicker, onApply }) => {
  const allDiffKeys = (data.tracks ?? []).flatMap(t =>
    (t.diffs ?? []).map(d => `${t.path}:${d.key}`)
  )
  const [keeps, setKeeps] = React.useState(() => {
    const init = {}
    ;(data.tracks ?? []).forEach(t =>
      (t.diffs ?? []).forEach(d => { if (d.preferLocal) init[`${t.path}:${d.key}`] = true })
    )
    return init
  })

  const applyCount = allDiffKeys.filter(k => !keeps[k]).length

  const toggleKeep = (path, key) => {
    const k = `${path}:${key}`
    setKeeps(prev => ({ ...prev, [k]: !prev[k] }))
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-1)', border: '2px solid var(--cyan)', width: 'min(96vw, 780px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em', color: 'var(--cyan)', marginBottom: 8 }}>MUSICBRAINZ TAG REVIEW</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
              <span style={{ color: 'var(--cyan)' }}>◆</span>{' '}
              {data.releaseTitle}
              {data.releaseArtist && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {data.releaseArtist}</span>}
              {data.releaseLabel  && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {data.releaseLabel}</span>}
              {data.releaseDate   && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {data.releaseDate}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
            <button className="btn ghost" style={{ fontSize: 11, whiteSpace: 'nowrap' }} onClick={onChangePicker}>Change…</button>
            <button className="btn ghost" style={{ fontSize: 13, padding: '2px 8px' }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 54px', padding: '7px 24px', borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-4)', gap: 8, flexShrink: 0 }}>
          <div>Field</div>
          <div>Current</div>
          <div>MusicBrainz</div>
          <div style={{ textAlign: 'center' }}>Keep?</div>
        </div>

        {/* Scrollable track list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {(data.tracks ?? []).every(t => (t.diffs ?? []).length === 0) && (
            <div style={{ padding: '24px', fontSize: 13, color: 'var(--ink-3)' }}>
              All tags are already in sync with MusicBrainz. Identifier tags will be updated on apply.
            </div>
          )}
          {(data.tracks ?? []).filter(t => (t.diffs ?? []).length > 0).map(track => (
            <div key={track.path}>
              <div style={{ padding: '9px 24px 7px', fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
                {track.filename}
              </div>
              {(track.diffs ?? []).map(diff => {
                const keepKey = `${track.path}:${diff.key}`
                const kept = !!keeps[keepKey]
                return (
                  <div
                    key={diff.key}
                    style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 54px', padding: '9px 24px', borderBottom: '1px solid var(--line)', gap: 8, alignItems: 'center', opacity: kept ? 0.4 : 1 }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{diff.label}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {diff.current || '—'}
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: kept ? 'var(--ink-3)' : 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {diff.proposed}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <input
                        type="checkbox"
                        checked={kept}
                        onChange={() => toggleKeep(track.path, diff.key)}
                        style={{ accentColor: 'var(--cyan)', cursor: 'pointer', width: 14, height: 14 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          <div style={{ padding: '12px 24px', fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
            Only rows where values differ are shown. Identifier tags (MusicBrainz IDs, AcoustID) are always written.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setKeeps(Object.fromEntries(allDiffKeys.map(k => [k, true])))}>
            Keep all mine
          </button>
          <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setKeeps({})}>
            Accept all MB
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onApply(keeps)}>
            Apply {applyCount}▶
          </button>
        </div>
      </div>
    </div>
  )
}

const MBPickerDialog = ({ results, artist, album, onReviewTags, onClose }) => {
  const { perPath, releases: fpReleases, totalPaths } = results
  const matched = perPath.filter(r => r.recordingId).length
  const firstMatch = perPath.find(r => r.recordingTitle)
  const noFpResults = fpReleases.length === 0

  const [searchMode, setSearchMode] = React.useState(noFpResults)
  const [searchArtist, setSearchArtist] = React.useState(artist ?? '')
  const [searchAlbum, setSearchAlbum] = React.useState(album ?? '')
  const [searchResults, setSearchResults] = React.useState(null)
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState(null)

  const activeReleases = searchMode && searchResults ? searchResults : fpReleases
  const [selectedId, setSelectedId] = React.useState(() => fpReleases[0]?.id ?? null)

  React.useEffect(() => {
    setSelectedId(activeReleases[0]?.id ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMode, searchResults])

  React.useEffect(() => {
    if (noFpResults && (searchArtist || searchAlbum)) doSearch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSearch = async () => {
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch('/api/library/musicbrainz/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: searchArtist, album: searchAlbum }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSearchResults(data.releases)
    } catch (e) {
      setSearchError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const handleApply = () => {
    if (!selectedId) return
    onReviewTags(selectedId)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-1)', border: '2px solid var(--line)', width: 'min(96vw, 720px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.04em', color: 'var(--cyan)', marginBottom: 8 }}>MUSICBRAINZ — SELECT RELEASE</div>
            {!searchMode && firstMatch && (
              <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{firstMatch.recordingTitle}</div>
            )}
            {!searchMode && firstMatch?.recordingArtist && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{firstMatch.recordingArtist}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
              {searchMode
                ? 'Searching MusicBrainz by artist and album name'
                : `Fingerprint matched ${matched} of ${totalPaths} track${totalPaths !== 1 ? 's' : ''}`
              }
            </div>
          </div>
          {!noFpResults && (
            <button
              className="btn ghost"
              style={{ fontSize: 11, whiteSpace: 'nowrap' }}
              onClick={() => { setSearchMode(m => !m); setSearchResults(null) }}
            >
              {searchMode ? '← Fingerprint results' : 'Search manually →'}
            </button>
          )}
        </div>

        {/* Search form (search mode only) */}
        {searchMode && (
          <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ marginBottom: 4 }}>Artist</div>
              <input
                className="field"
                value={searchArtist}
                onChange={e => setSearchArtist(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Album artist…"
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ marginBottom: 4 }}>Album</div>
              <input
                className="field"
                value={searchAlbum}
                onChange={e => setSearchAlbum(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Album title…"
              />
            </div>
            <button className="btn ghost" onClick={doSearch} disabled={searching || (!searchArtist && !searchAlbum)}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
        )}

        {/* Results */}
        {searchMode ? (
          searchError ? (
            <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--pink)' }}>{searchError}</div>
          ) : searching ? (
            <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--ink-3)' }}>Searching…</div>
          ) : searchResults === null ? (
            <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--ink-3)' }}>Enter an artist and album name above to search.</div>
          ) : searchResults.length === 0 ? (
            <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--ink-3)' }}>No results found.</div>
          ) : (
            <MBReleaseTable releases={searchResults} selectedId={selectedId} onSelect={setSelectedId} totalPaths={totalPaths} />
          )
        ) : fpReleases.length === 0 ? (
          <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--ink-3)' }}>
            No fingerprint matches found — the audio may not be in the AcoustID database.
          </div>
        ) : (
          <MBReleaseTable releases={fpReleases} selectedId={selectedId} onSelect={setSelectedId} totalPaths={totalPaths} />
        )}

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {searchMode && (
            <div style={{ fontSize: 11, color: 'var(--ink-4)', flex: 1 }}>
              Track positions are matched by order — ensure files are in track-number order.
            </div>
          )}
          {!searchMode && <span style={{ flex: 1 }} />}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={handleApply}
            disabled={!selectedId || activeReleases.length === 0}
          >
            Review Tags →
          </button>
        </div>
      </div>
    </div>
  )
}

const ArtCard = ({ url, label, sublabel, actions, onExpand }) => {
  const [loaded, setLoaded] = React.useState(false)
  const [errored, setErrored] = React.useState(false)
  const [hover, setHover] = React.useState(false)
  return (
    <div style={{ width: 210, border: '1px solid var(--line)', background: 'var(--bg-0)', overflow: 'hidden' }}>
      <div
        style={{ width: '100%', height: 210, background: 'var(--bg-2)', position: 'relative', cursor: onExpand && loaded ? 'zoom-in' : 'default' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={loaded ? onExpand : undefined}
      >
        {!errored && (
          <img
            src={url}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: loaded ? 'block' : 'none' }}
            alt=""
          />
        )}
        {!loaded && !errored && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-4)', fontSize: 11 }}>Loading…</div>
        )}
        {errored && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-4)', fontSize: 11 }}>No preview</div>
        )}
        {hover && onExpand && loaded && (
          <div style={{ position: 'absolute', top: 6, right: 6, background: 'oklch(0 0 0 / 0.65)', color: 'white', fontSize: 14, lineHeight: 1, padding: '4px 5px', pointerEvents: 'none' }}>⤢</div>
        )}
      </div>
      <div style={{ padding: '7px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {sublabel && <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4 }}>{sublabel}</div>}
        {actions.map((a, i) => (
          <button
            key={i}
            className="btn ghost"
            onClick={a.onClick}
            disabled={a.disabled}
            style={{ fontSize: 10, padding: '3px 6px', marginTop: 3, width: '100%', color: a.color, borderColor: a.color, opacity: a.disabled ? 0.5 : 1 }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const Lightbox = ({ url, label, sublabel, actions, onClose }) => (
  <div
    style={{ position: 'fixed', inset: 0, zIndex: 101, background: 'oklch(0 0 0 / 0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={e => { e.stopPropagation(); onClose() }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-1)', border: '2px solid var(--line)', maxWidth: 'min(88vw, 960px)' }}
    >
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
        {sublabel && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{sublabel}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose} style={{ padding: '3px 8px', fontSize: 11 }}>✕ Close</button>
      </div>
      <img
        src={url}
        style={{ display: 'block', maxWidth: 'min(88vw, 960px)', maxHeight: '72vh', objectFit: 'contain', background: 'var(--bg-0)' }}
        alt={label}
      />
      {actions.length > 0 && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, flex: '0 0 auto' }}>
          {actions.map((a, i) => (
            <button
              key={i}
              className="btn ghost"
              onClick={a.onClick}
              disabled={a.disabled}
              style={{ fontSize: 11, color: a.color, borderColor: a.color, opacity: a.disabled ? 0.5 : 1 }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
)

const ArtDialog = ({ albumObj, onClose }) => {
  const [arts, setArts] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [op, setOp] = React.useState(null)
  const [uploadPreview, setUploadPreview] = React.useState(null)
  const [uploadFile, setUploadFile] = React.useState(null)
  const [lightbox, setLightbox] = React.useState(null)
  const fileRef = React.useRef(null)

  const firstTrackPath = albumObj?.tracks[0]?.path ?? null
  const folderPath = firstTrackPath ? firstTrackPath.substring(0, firstTrackPath.lastIndexOf('/')) : null
  const trackPaths = React.useMemo(() => albumObj?.tracks.map(t => t.path) ?? [], [albumObj])

  const load = React.useCallback(() => {
    if (!folderPath || !firstTrackPath) return
    setArts(null)
    setError(null)
    fetch(`/api/art/list?folder=${encodeURIComponent(folderPath)}&sampleTrack=${encodeURIComponent(firstTrackPath)}`)
      .then(r => r.json())
      .then(setArts)
      .catch(e => setError(e.message))
  }, [folderPath, firstTrackPath])

  React.useEffect(() => { load() }, [load])

  const removeEmbedded = async () => {
    setLightbox(null)
    setOp('remove-embed')
    setError(null)
    try {
      const r = await fetch('/api/art/embed', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackPaths }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error) }
      load()
    } catch (e) { setError(e.message) }
    finally { setOp(null) }
  }

  const embedFromFile = async (filePath, mimeType) => {
    setLightbox(null)
    setOp(`embed-${filePath}`)
    setError(null)
    try {
      const r = await fetch('/api/art/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackPaths, fromFilePath: filePath, mimeType, pictureType: 3 }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error) }
      load()
    } catch (e) { setError(e.message) }
    finally { setOp(null) }
  }

  const deleteFile = async (filePath) => {
    setLightbox(null)
    setOp(`del-${filePath}`)
    setError(null)
    try {
      const r = await fetch('/api/art/file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
      if (!r.ok) throw new Error('Delete failed')
      load()
    } catch (e) { setError(e.message) }
    finally { setOp(null) }
  }

  const fetchOnline = async () => {
    if (!firstTrackPath) return
    setOp('fetch')
    setError(null)
    try {
      const first = v => (Array.isArray(v) ? v[0] : v) || ''
      let releaseId = ''
      let releaseGroupId = ''
      // Use the first track carrying a MusicBrainz ID; the first track alone may lack one
      for (const t of albumObj?.tracks ?? []) {
        if (releaseId && releaseGroupId) break
        const tr = await fetch(`/api/tags?path=${encodeURIComponent(t.path)}`)
        if (!tr.ok) continue
        const { tags } = await tr.json()
        releaseId = releaseId || first(tags?.mb_releaseid)
        releaseGroupId = releaseGroupId || first(tags?.mb_releasegroupid)
        if (releaseId || releaseGroupId) break
      }
      if (!releaseId && !releaseGroupId) throw new Error('No MusicBrainz release ID on first track — tag the album first')
      const qs = new URLSearchParams()
      if (releaseId) qs.set('releaseId', releaseId)
      if (releaseGroupId) qs.set('releaseGroupId', releaseGroupId)
      const r = await fetch(`/api/art/fetch?${qs}`)
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? 'No cover art found') }
      const blob = await r.blob()
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(blob)
      })
      const ext = (blob.type.split('/')[1] || 'jpeg').replace('jpeg', 'jpg')
      setUploadFile(new File([blob], `cover.${ext}`, { type: blob.type }))
      setUploadPreview(dataUrl)
    } catch (e) { setError(e.message) }
    finally { setOp(null) }
  }

  const handleFileSelect = e => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    const reader = new FileReader()
    reader.onload = ev => setUploadPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  const uploadAsFolder = async () => {
    if (!uploadFile || !folderPath || !uploadPreview) return
    setOp('upload')
    setError(null)
    try {
      const r = await fetch('/api/art/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath, filename: uploadFile.name, data: uploadPreview, mimeType: uploadFile.type }),
      })
      if (!r.ok) throw new Error('Save failed')
      setUploadFile(null); setUploadPreview(null)
      load()
    } catch (e) { setError(e.message) }
    finally { setOp(null) }
  }

  const uploadAsEmbed = async () => {
    if (!uploadFile || !uploadPreview) return
    setOp('upload')
    setError(null)
    try {
      const r = await fetch('/api/art/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackPaths, data: uploadPreview, mimeType: uploadFile.type, pictureType: 3 }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error) }
      setUploadFile(null); setUploadPreview(null)
      load()
    } catch (e) { setError(e.message) }
    finally { setOp(null) }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 680, maxHeight: '82vh', background: 'var(--bg-1)', border: '2px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.06em' }}>
            ART MANAGER — {albumObj?.name?.toUpperCase() ?? ''}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{trackPaths.length} tracks</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ padding: '4px 10px', fontSize: 12 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {!arts && !error && <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</div>}
          {error && <div style={{ color: 'var(--pink)', fontSize: 12, marginBottom: 12 }}>Error: {error}</div>}

          {arts && (<>
            <div className="label" style={{ marginBottom: 10 }}>EMBEDDED ART</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 10 }}>
              Sampled from first track · changes apply to all {trackPaths.length} tracks
            </div>
            {arts.embedded.length === 0
              ? <div style={{ color: 'var(--ink-3)', fontSize: 12, marginBottom: 20, padding: 12, border: '1px dashed var(--line)', textAlign: 'center' }}>No embedded art</div>
              : <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                  {arts.embedded.map(item => {
                    const embeddedActions = [{
                      label: op === 'remove-embed' ? 'Removing…' : 'Remove from all tracks',
                      color: 'var(--pink)',
                      onClick: removeEmbedded,
                      disabled: !!op,
                    }]
                    return (
                      <ArtCard
                        key={item.index}
                        url={item.url}
                        label={item.pictureTypeLabel}
                        sublabel={`${(item.size / 1024).toFixed(0)} KB · ${item.mimeType.split('/')[1]?.toUpperCase()}`}
                        actions={embeddedActions}
                        onExpand={() => setLightbox({ url: item.url, label: item.pictureTypeLabel, sublabel: `${(item.size / 1024).toFixed(0)} KB · ${item.mimeType}`, actions: embeddedActions })}
                      />
                    )
                  })}
                </div>
            }

            <div className="label" style={{ marginBottom: 10 }}>FOLDER FILES</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 10 }}>
              Image files in <span className="mono">{folderPath?.split('/').pop()}/</span>
            </div>
            {arts.folderFiles.length === 0
              ? <div style={{ color: 'var(--ink-3)', fontSize: 12, marginBottom: 8, padding: 12, border: '1px dashed var(--line)', textAlign: 'center' }}>No image files in album folder</div>
              : <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {arts.folderFiles.map(item => {
                    const fileActions = [
                      {
                        label: op === `embed-${item.filePath}` ? 'Embedding…' : 'Embed in all tracks',
                        color: 'var(--green)',
                        onClick: () => embedFromFile(item.filePath, item.mimeType),
                        disabled: !!op,
                      },
                      {
                        label: op === `del-${item.filePath}` ? 'Deleting…' : 'Delete file',
                        color: 'var(--pink)',
                        onClick: () => deleteFile(item.filePath),
                        disabled: !!op,
                      },
                    ]
                    return (
                      <ArtCard
                        key={item.filePath}
                        url={item.url}
                        label={item.name}
                        sublabel={item.mimeType.split('/')[1]?.toUpperCase()}
                        actions={fileActions}
                        onExpand={() => setLightbox({ url: item.url, label: item.name, sublabel: item.mimeType, actions: fileActions })}
                      />
                    )
                  })}
                </div>
            }
          </>)}

          {/* Upload preview */}
          {uploadPreview && (
            <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--cyan)', background: 'color-mix(in oklch, var(--cyan) 5%, transparent)' }}>
              <div className="label" style={{ marginBottom: 8 }}>SELECTED: {uploadFile?.name}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img src={uploadPreview} style={{ width: 80, height: 80, objectFit: 'cover', border: '1px solid var(--line)' }} alt="" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="btn primary" onClick={uploadAsEmbed} disabled={!!op} style={{ fontSize: 12 }}>
                    {op === 'upload' ? 'Working…' : 'Embed in all tracks'}
                  </button>
                  <button className="btn ghost" onClick={uploadAsFolder} disabled={!!op} style={{ fontSize: 12 }}>
                    Save as folder file
                  </button>
                  <button className="btn ghost" onClick={() => { setUploadFile(null); setUploadPreview(null) }} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1.5px solid var(--line)', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          {error && <span style={{ fontSize: 11, color: 'var(--pink)' }}>{error}</span>}
          <span style={{ flex: 1 }} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />
          <button className="btn" onClick={fetchOnline} disabled={!!op} title="Download cover art from MusicBrainz / Cover Art Archive">
            {op === 'fetch' ? 'Fetching…' : 'Fetch Online'}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!op}>+ Add Image</button>
        </div>
      </div>

      {lightbox && (
        <Lightbox
          url={lightbox.url}
          label={lightbox.label}
          sublabel={lightbox.sublabel}
          actions={lightbox.actions}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
