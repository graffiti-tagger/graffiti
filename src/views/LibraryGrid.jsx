import React from 'react'
import { useLocation } from 'react-router-dom'
import { TopNav, StatusBar, Pill } from '../components/shell.jsx'
import { TAGS, CORE_FIELD_TAGS } from '../data/tags.js'
import { ID3_GENRES_SORTED } from '../data/id3genres.js'
import FixDialog from '../components/FixDialog.jsx'

// Column widths for tags that need specific sizing in the grid
const COL_WIDTHS = {
  title: 220, artist: 160, album: 180, albumartist: 160,
  tracknumber: 60, date: 70, genre: 110, discnumber: 60,
  bpm: 60, composer: 140, isrc: 130, label: 140, comment: 180,
}
const COL_ALIGN_RIGHT = new Set(["tracknumber", "date", "discnumber", "bpm"])

// File-level read-only columns not in the tag schema
const FILE_COLS = [
  { key: "health", label: "Health",    w: 80,  readOnly: true },
  { key: "fmt",    label: "Format",    w: 70,  readOnly: true },
  { key: "dur",    label: "Duration",  w: 80,  align: "right", readOnly: true },
  { key: "path",   label: "File Path", w: 340, readOnly: true },
]

const ALL_COLUMNS = [
  ...TAGS.filter(t => !t.readOnly && t.key !== "acoustid_fingerprint" && t.key !== "lyrics").map(t => ({
    key: t.key,
    label: t.label,
    w: COL_WIDTHS[t.key] ?? 120,
    align: COL_ALIGN_RIGHT.has(t.key) ? "right" : "left",
  })),
  ...FILE_COLS,
]

// Default visible columns derived from core field tags, in a sensible display order, plus read-only file cols
const CORE_ORDER = ["albumartist", "artist", "album", "tracknumber", "discnumber", "title", "date", "genre"]
const DEFAULT_COLS = [...CORE_ORDER.filter(k => CORE_FIELD_TAGS.some(t => t.key === k)), "health", "dur", "fmt"]

const CHECKBOX_COL_W = 36
const MIN_COL_W = 40

const initWidths = () => {
  try {
    const saved = localStorage.getItem('gt:grid:colWidths')
    if (saved) {
      const parsed = JSON.parse(saved)
      // Merge saved widths over defaults so new columns get their default width
      return { ...Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.w])), ...parsed }
    }
  } catch {}
  return Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.w]))
}

const initVisible = () => {
  try {
    const saved = localStorage.getItem('gt:grid:visible')
    if (saved) {
      const parsed = JSON.parse(saved)
      // Only keep keys that still exist in ALL_COLUMNS
      const valid = parsed.filter(k => ALL_COLUMNS.some(c => c.key === k))
      if (valid.length > 0) return valid
    }
  } catch {}
  return DEFAULT_COLS
}

const initFilters = () => {
  try {
    const saved = localStorage.getItem('gt:grid:filters')
    if (saved) return JSON.parse(saved)
  } catch {}
  return {}
}

const initEmptyOnly = () => {
  try {
    const saved = localStorage.getItem('gt:grid:emptyOnly')
    if (saved) return new Set(JSON.parse(saved))
  } catch {}
  return new Set()
}

const initSortKey = () => localStorage.getItem('gt:grid:sortKey') ?? 'albumartist'
const initSortDir = () => localStorage.getItem('gt:grid:sortDir') ?? 'asc'

const LibraryGrid = ({ onAddMusic }) => {
  const [tracks, setTracks] = React.useState([])
  const [libraryPath, setLibraryPath] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [visible, setVisible] = React.useState(initVisible)
  const [sortKey, setSortKey] = React.useState(initSortKey)
  const [sortDir, setSortDir] = React.useState(initSortDir)
  const [filters, setFilters] = React.useState(initFilters)
  const [emptyOnly, setEmptyOnly] = React.useState(initEmptyOnly)
  const [filterFocus, setFilterFocus] = React.useState(null)
  const [editing, setEditing] = React.useState(null)
  const [edits, setEdits] = React.useState({})
  const [colMenu, setColMenu] = React.useState(false)
  const [selected, setSelected] = React.useState(new Set())
  const [colWidths, setColWidths] = React.useState(initWidths)
  const [fixState, setFixState] = React.useState(null)
  const [tagSettings, setTagSettings] = React.useState({})
  const dragState = React.useRef(null)

  React.useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(cfg => setTagSettings(cfg.tagSettings ?? {})).catch(() => {})
  }, [])

  React.useEffect(() => { localStorage.setItem('gt:grid:visible',   JSON.stringify(visible)) }, [visible])
  React.useEffect(() => { localStorage.setItem('gt:grid:colWidths', JSON.stringify(colWidths)) }, [colWidths])
  React.useEffect(() => { localStorage.setItem('gt:grid:filters',   JSON.stringify(filters)) }, [filters])
  React.useEffect(() => { localStorage.setItem('gt:grid:emptyOnly', JSON.stringify([...emptyOnly])) }, [emptyOnly])
  React.useEffect(() => { localStorage.setItem('gt:grid:sortKey',   sortKey) }, [sortKey])
  React.useEffect(() => { localStorage.setItem('gt:grid:sortDir',   sortDir) }, [sortDir])

  const location = useLocation()
  React.useEffect(() => {
    const params = new URLSearchParams(location.search)
    const empty = params.get('empty')
    if (empty) {
      const cols = empty.split(',').filter(Boolean)
      setEmptyOnly(new Set(cols))
      // ensure those columns are visible (only if not ignored)
      setVisible(v => {
        const missing = cols.filter(c => !v.includes(c) && ALL_COLUMNS.some(col => col.key === c) && (tagSettings[c] ?? 'optional') !== 'ignored')
        return missing.length ? [...v, ...missing] : v
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  const fetchTracks = () => {
    setLoading(true)
    fetch('/api/library/tracks')
      .then(async r => {
        const text = await r.text()
        if (!text) throw new Error('No response from server')
        return JSON.parse(text)
      })
      .then(data => {
        setTracks(data.tracks ?? [])
        setLibraryPath(data.libraryPath ?? "")
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  React.useEffect(() => { fetchTracks() }, [])

  React.useEffect(() => {
    const handler = () => fetchTracks()
    window.addEventListener('gt:library-refresh', handler)
    return () => window.removeEventListener('gt:library-refresh', handler)
  }, [])

  // Filter out ignored tags — they can't be shown or chosen
  const availableColumns = ALL_COLUMNS.filter(c => (tagSettings[c.key] ?? 'optional') !== 'ignored')
  const cols = visible.map(k => availableColumns.find(c => c.key === k)).filter(Boolean)

  let rows = tracks.filter(r =>
    Object.entries(filters).every(([k, v]) => {
      if (!v) return true
      return String(r[k] ?? "").toLowerCase().includes(v.toLowerCase())
    }) &&
    [...emptyOnly].every(k => !r[k])
  )
  rows = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? ""; const bv = b[sortKey] ?? ""
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  const rowIds = rows.map(r => r.id)
  const allSelected = rowIds.length > 0 && rowIds.every(id => selected.has(id))
  const someSelected = rowIds.some(id => selected.has(id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(s => { const n = new Set(s); rowIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(s => new Set([...s, ...rowIds]))
    }
  }

  const toggleRow = id => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const onHeaderClick = k => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("asc") }
  }

  const onResizeMouseDown = (e, key) => {
    e.preventDefault()
    e.stopPropagation()
    dragState.current = { key, startX: e.clientX, startW: colWidths[key] }

    const onMove = ev => {
      if (!dragState.current) return
      const { key, startX, startW } = dragState.current
      const newW = Math.max(MIN_COL_W, startW + ev.clientX - startX)
      setColWidths(w => ({ ...w, [key]: newW }))
    }
    const onUp = () => {
      dragState.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const valueFor = (r, k) => {
    const ek = `${r.id}:${k}`
    return ek in edits ? edits[ek] : (r[k] ?? "")
  }
  const isEdited = (r, k) => `${r.id}:${k}` in edits

  const commitEdit = (r, k, v) => {
    const original = r[k] ?? ""
    setEdits(e => {
      if (v === original) {
        const { [`${r.id}:${k}`]: _, ...rest } = e
        return rest
      }
      return { ...e, [`${r.id}:${k}`]: v }
    })
    setEditing(null)
  }

  const [committing, setCommitting] = React.useState(false)

  const commitAll = async () => {
    setCommitting(true)
    // Group edits by track id
    const byTrack = {}
    for (const [key, value] of Object.entries(edits)) {
      const colon = key.indexOf(':')
      const id = Number(key.slice(0, colon))
      const tag = key.slice(colon + 1)
      if (!byTrack[id]) byTrack[id] = {}
      byTrack[id][tag] = value
    }
    // Write each track's changed tags
    const results = await Promise.allSettled(
      Object.entries(byTrack).map(([id, tags]) => {
        const track = tracks.find(t => t.id === Number(id))
        if (!track?.path) return Promise.reject(new Error(`No path for track ${id}`))
        return fetch(`/api/tags?path=${encodeURIComponent(track.path)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tags),
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`) })
      })
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === 0) {
      setEdits({})
      fetchTracks()
    } else {
      alert(`${failed} track(s) failed to save. Check the console for details.`)
      results.forEach((r) => r.status === 'rejected' && console.error(`Track write failed:`, r.reason))
    }
    setCommitting(false)
  }

  const bulkEdit = (key, value) => {
    setEdits(prev => {
      const next = { ...prev }
      for (const id of selected) {
        const track = tracks.find(t => t.id === id)
        if (!track) continue
        const original = track[key] ?? ""
        const editKey = `${id}:${key}`
        if (value === original) delete next[editKey]
        else next[editKey] = value
      }
      return next
    })
  }

  const pendingCount = Object.keys(edits).length
  const selectedCount = selected.size
  const selectedTracks = React.useMemo(
    () => tracks.filter(t => selected.has(t.id)),
    [tracks, selected]
  )
  const allSelectedMp3 = selectedTracks.length > 0 && selectedTracks.every(t => t.fmt === "MP3")

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      <TopNav active="grid" pendingCount={pendingCount} onCommit={commitAll} onAddMusic={onAddMusic} />

      {/* Toolbar */}
      <div style={{ height: 44, padding: "0 18px", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-1)", borderBottom: "1.5px solid var(--line)", flex: "0 0 auto" }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 13, letterSpacing: "0.04em" }}>GRID</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {loading ? "Loading…" : `${rows.length} of ${tracks.length} tracks`}
          {selectedCount > 0 && <span style={{ color: "var(--cyan)", marginLeft: 8 }}>· {selectedCount} selected</span>}
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <button className="btn sm" onClick={() => setColMenu(m => !m)}>
            ▦ Columns ({cols.length})
          </button>
          {colMenu && (
            <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 10, background: "var(--bg-2)", border: "1.5px solid var(--green)", boxShadow: "4px 4px 0 var(--pink)", padding: 12, width: 220, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div className="label" style={{ margin: 0 }}>Visible columns</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span onClick={() => setVisible(availableColumns.map(c => c.key))} style={{ fontSize: 11, color: "var(--cyan)", cursor: "pointer" }}>All</span>
                  <span style={{ color: "var(--ink-4)" }}>·</span>
                  <span onClick={() => setVisible(DEFAULT_COLS)} style={{ fontSize: 11, color: "var(--cyan)", cursor: "pointer" }}>Reset</span>
                </div>
              </div>
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                {availableColumns.map(c => (
                  <label key={c.key} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={visible.includes(c.key)}
                      onChange={() => setVisible(v => v.includes(c.key) ? v.filter(x => x !== c.key) : [...v, c.key])}
                      style={{ accentColor: "var(--green)" }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className="btn sm" onClick={() => { setFilters({}); setEmptyOnly(new Set()) }}>Clear filters</button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg-0)" }} onClick={() => colMenu && setColMenu(false)}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed", minWidth: "100%" }}>
          <colgroup>
            <col style={{ width: CHECKBOX_COL_W }} />
            {cols.map(c => <col key={c.key} style={{ width: colWidths[c.key] ?? c.w }} />)}
          </colgroup>
          <thead>
            <tr style={{ background: "var(--bg-1)", position: "sticky", top: 0, zIndex: 2 }}>
              <th style={{ width: CHECKBOX_COL_W, padding: "8px 0", borderBottom: "1.5px solid var(--line)", textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleSelectAll}
                  style={{ accentColor: "var(--green)", cursor: "pointer" }}
                />
              </th>
              {cols.map(c => (
                <th key={c.key} onClick={() => onHeaderClick(c.key)} style={{
                  width: colWidths[c.key] ?? c.w,
                  padding: "8px 12px",
                  textAlign: c.align || "left",
                  fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: sortKey === c.key ? "var(--green)" : "var(--ink-3)",
                  fontWeight: 700,
                  borderBottom: "1.5px solid var(--line)",
                  cursor: "pointer", userSelect: "none",
                  position: "relative",
                  overflow: "visible",
                }}>
                  {c.label}
                  {sortKey === c.key && <span style={{ marginLeft: 6 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                  {/* Resize handle — header only */}
                  <ResizeHandle onMouseDown={e => onResizeMouseDown(e, c.key)} />
                </th>
              ))}
            </tr>
            {selectedCount < 2 && (
              <tr style={{ background: "var(--bg-2)", position: "sticky", top: 33, zIndex: 2 }}>
                <th style={{ borderBottom: "1.5px solid var(--line)" }} />
                {cols.map(c => (
                  <th key={c.key} style={{ padding: "5px 8px", borderBottom: "1.5px solid var(--line)", overflow: "visible", position: "relative" }}>
                    {emptyOnly.has(c.key) ? (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 6px", fontSize: 11,
                        background: "color-mix(in oklch, var(--yellow) 15%, var(--bg-0))",
                        border: "1px solid var(--yellow)", color: "var(--yellow)",
                      }}>
                        <span style={{ flex: 1 }}>empty only</span>
                        <span
                          onClick={() => setEmptyOnly(s => { const n = new Set(s); n.delete(c.key); return n })}
                          style={{ cursor: "pointer", opacity: 0.7, fontSize: 13, lineHeight: 1 }}
                        >×</span>
                      </div>
                    ) : (
                    <div style={{ position: "relative" }}>
                      <input
                        placeholder="filter…"
                        value={filters[c.key] || ""}
                        onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))}
                        onFocus={() => setFilterFocus(c.key)}
                        onBlur={() => setTimeout(() => setFilterFocus(f => f === c.key ? null : f), 150)}
                        style={{
                          width: "100%", padding: "3px 6px", fontSize: 12,
                          background: "var(--bg-0)", color: "var(--ink)",
                          border: "1px solid var(--line)", fontFamily: "var(--f-ui)",
                          outline: "none",
                        }}
                      />
                      {filterFocus === c.key
                        && filters[c.key]
                        && "empty".startsWith(filters[c.key].toLowerCase())
                        && (
                        <div
                          onMouseDown={e => {
                            e.preventDefault()
                            setEmptyOnly(s => new Set([...s, c.key]))
                            setFilters(f => { const n = { ...f }; delete n[c.key]; return n })
                            setFilterFocus(null)
                          }}
                          style={{
                            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                            background: "var(--bg-2)", border: "1px solid var(--yellow)",
                            padding: "4px 7px", cursor: "pointer", marginTop: 1,
                            display: "flex", alignItems: "center", gap: 6,
                            fontSize: 11, color: "var(--yellow)",
                          }}
                        >
                          <span>⬚</span>
                          <span>Show empty only</span>
                        </div>
                      )}
                    </div>
                  )}
                  </th>
                ))}
              </tr>
            )}
            {selectedCount >= 2 && (() => {
              const bulkInputStyle = {
                width: "100%", padding: "3px 6px", fontSize: 12,
                background: "var(--bg-0)",
                color: "var(--ink)", border: "1px solid var(--line)",
                fontFamily: "var(--f-ui)", outline: "none",
              }
              return (
                <tr style={{ background: "color-mix(in oklch, var(--cyan) 10%, var(--bg-1))", position: "sticky", top: 33, zIndex: 2, outline: "1.5px solid var(--pink)" }}>
                  <th style={{ borderBottom: "1.5px solid var(--pink)", borderTop: "1.5px solid var(--pink)", padding: "4px 0", textAlign: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--cyan)", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.8 }}>bulk</span>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--cyan)", fontWeight: 700, lineHeight: 1 }}>{selectedCount}</span>
                    </div>
                  </th>
                  {cols.map(c => {
                    if (c.readOnly) return (
                      <th key={c.key} style={{ borderBottom: "1.5px solid var(--pink)", borderTop: "1.5px solid var(--pink)" }} />
                    )
                    const vals = new Set(selectedTracks.map(t => { const ek = `${t.id}:${c.key}`; return ek in edits ? edits[ek] : (t[c.key] ?? "") }))
                    const mixed = vals.size > 1
                    const value = mixed ? "" : ([...vals][0] ?? "")
                    return (
                      <th key={c.key} style={{ padding: "4px 6px", borderBottom: "1.5px solid var(--pink)", borderTop: "1.5px solid var(--pink)" }}>
                        {c.key === "genre" && allSelectedMp3 ? (
                          <select
                            key={`bulk-${c.key}-${value}`}
                            defaultValue={value}
                            onChange={e => bulkEdit(c.key, e.target.value)}
                            style={bulkInputStyle}
                          >
                            <option value="">—</option>
                            {ID3_GENRES_SORTED.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        ) : (
                          <input
                            key={`bulk-${c.key}-${mixed}-${value}`}
                            defaultValue={value}
                            placeholder={mixed ? "(mixed)" : ""}
                            onKeyDown={e => {
                              if (e.key === "Enter") { bulkEdit(c.key, e.target.value); e.target.blur() }
                              if (e.key === "Escape") e.target.blur()
                            }}
                            onBlur={e => { if (e.target.value !== value) bulkEdit(c.key, e.target.value) }}
                            style={bulkInputStyle}
                          />
                        )}
                      </th>
                    )
                  })}
                </tr>
              )
            })()}
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isSelected = selected.has(r.id)
              return (
                <tr key={r.id} style={{ background: isSelected ? "color-mix(in oklch, var(--cyan) 8%, transparent)" : i % 2 ? "var(--bg-0)" : "transparent" }}>
                  <td style={{ padding: "6px 0", borderBottom: "1px solid var(--line-soft)", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(r.id)}
                      style={{ accentColor: "var(--green)", cursor: "pointer" }}
                    />
                  </td>
                  {cols.map(c => {
                    const rawV = valueFor(r, c.key)
                  const v = c.key === "path" && libraryPath && rawV.startsWith(libraryPath)
                    ? rawV.slice(libraryPath.length).replace(/^\//, '')
                    : rawV
                    const edited = isEdited(r, c.key)
                    const isEditingCell = editing && editing.id === r.id && editing.key === c.key
                    const cellStyle = {
                      padding: "6px 12px",
                      borderBottom: "1px solid var(--line-soft)",
                      color: edited ? "var(--pink)" : c.readOnly ? "var(--ink-4)" : "var(--ink-2)",
                      textAlign: c.align || "left",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      cursor: c.readOnly ? "default" : "text",
                      fontWeight: edited ? 600 : 400,
                      background: edited ? "color-mix(in oklch, var(--pink) 10%, transparent)" : "transparent",
                    }
                    const editInputStyle = {
                      width: "100%", padding: "5px 10px",
                      background: "var(--bg-0)", color: "var(--ink)",
                      border: "2px solid var(--green)", outline: "none",
                      fontFamily: "var(--f-ui)", fontSize: 13,
                    }
                    if (isEditingCell) return (
                      <td key={c.key} style={{ ...cellStyle, padding: 2 }}>
                        {c.key === "genre" && r.fmt === "MP3"
                          ? <select autoFocus value={v} style={editInputStyle}
                              onChange={e => commitEdit(r, c.key, e.target.value)}
                              onBlur={e => commitEdit(r, c.key, e.target.value)}
                              onKeyDown={e => e.key === "Escape" && setEditing(null)}
                            >
                              <option value="">—</option>
                              {ID3_GENRES_SORTED.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                          : <input
                              autoFocus
                              defaultValue={v}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitEdit(r, c.key, e.target.value)
                                if (e.key === "Escape") setEditing(null)
                              }}
                              onBlur={e => commitEdit(r, c.key, e.target.value)}
                              style={editInputStyle}
                            />
                        }
                      </td>
                    )
                    if (c.key === "health") {
                      const score = r.health !== null && r.health !== undefined ? r.health : null
                      if (score === null) return <td key={c.key} style={cellStyle}><span style={{ color: "var(--ink-4)" }}>—</span></td>
                      const hColor = score >= 90 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : 'var(--pink)'
                      return (
                        <td key={c.key} style={{ ...cellStyle, cursor: 'pointer' }} onClick={() => {
                          const albumPaths = tracks.filter(t => t.albumartist === r.albumartist && t.album === r.album).map(t => t.path).filter(Boolean)
                          setFixState({ paths: albumPaths, scope: 'album', albumName: r.album })
                        }}>
                          <span style={{
                            fontSize: 11, fontFamily: 'var(--f-mono)',
                            padding: '1px 6px',
                            background: `color-mix(in oklch, ${hColor} 15%, transparent)`,
                            border: `1px solid ${hColor}`,
                            color: hColor,
                          }}>{score}%</span>
                        </td>
                      )
                    }
                    if (c.key === "fmt") {
                      return (
                        <td key={c.key} style={cellStyle}>
                          <Pill accent={v === "FLAC" ? "green" : v === "MP3" ? "cyan" : v === "OGG" ? "yellow" : "pink"}>{v}</Pill>
                        </td>
                      )
                    }
                    return (
                      <td key={c.key} style={cellStyle} onClick={() => !c.readOnly && setEditing({ id: r.id, key: c.key })}>
                        {edited && <span style={{ color: "var(--pink)", marginRight: 5 }}>●</span>}
                        {v || <span style={{ color: "var(--ink-4)" }}>—</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pending operations bar */}
      {pendingCount > 0 && (
        <div style={{
          padding: "10px 18px",
          background: "var(--bg-2)",
          borderTop: "1.5px solid var(--green)",
          display: "flex", alignItems: "center", gap: 10,
          flex: "0 0 auto",
        }}>
          <span className="sticker pink" style={{ fontSize: 11 }}>● {pendingCount} PENDING</span>
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>Edits queued in memory — commit to write to disk.</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setEdits({})}>Discard all</button>
          <button className="btn primary" onClick={commitAll} disabled={committing}>
            {committing ? "Writing…" : "Commit changes"}
          </button>
        </div>
      )}

      <StatusBar
        left={`Sort: ${sortKey} ${sortDir === "asc" ? "↑" : "↓"} · Filters: ${Object.values(filters).filter(Boolean).length + emptyOnly.size}`}
        right="Click a cell to edit · Enter to save · Esc to cancel"
      />

      {fixState && (
        <FixDialog
          paths={fixState.paths}
          scope={fixState.scope}
          albumName={fixState.albumName}
          onClose={() => setFixState(null)}
        />
      )}
    </div>
  )
}

const ResizeHandle = ({ onMouseDown }) => {
  const [hover, setHover] = React.useState(false)
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0,
        width: 6,
        cursor: "col-resize",
        display: "flex", alignItems: "stretch", justifyContent: "center",
        zIndex: 1,
      }}
    >
      <div style={{
        width: 2,
        background: hover ? "var(--green)" : "transparent",
        transition: "background 120ms",
      }} />
    </div>
  )
}

export default LibraryGrid
