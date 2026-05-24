import React from 'react'
import { useNavigate } from 'react-router-dom'
import { TopNav, StatusBar } from '../components/shell.jsx'
import FixDialog from '../components/FixDialog.jsx'
import { useIsMobile } from '../hooks/useBreakpoint.js'

function splitArtists(albumartist) {
  if (!albumartist) return [albumartist]
  const parts = albumartist.split(/;(?! )/).map(s => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [albumartist]
}

const FMT_COLOR = {
  FLAC: 'var(--green)',
  MP3:  'var(--pink)',
  M4A:  'var(--cyan)',
  OGG:  'var(--yellow)',
  M4B:  'var(--orange)',
}
const GENRE_COLORS = [
  'var(--pink)', 'var(--green)', 'var(--cyan)',
  'var(--yellow)', 'var(--orange)', 'var(--ink-3)',
]

function parseSecs(dur) {
  if (!dur) return 0
  const [m, s] = dur.split(':').map(Number)
  return m * 60 + (s || 0)
}
function fmtDur(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
function fmtBytes(b) {
  if (!b) return '—'
  return b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`
}
function fmtAge(unixSecs) {
  if (!unixSecs) return ''
  const days = Math.floor((Date.now() / 1000 - unixSecs) / 86400)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function PieChart({ slices, size = 110 }) {
  const r = size / 2 - 5
  const cx = size / 2, cy = size / 2
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (!total) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg-3)" />
    </svg>
  )
  let angle = -Math.PI / 2
  return (
    <svg width={size} height={size}>
      {slices.map((s, i) => {
        const sweep = (s.value / total) * 2 * Math.PI
        const x1 = cx + r * Math.cos(angle)
        const y1 = cy + r * Math.sin(angle)
        angle += sweep
        const x2 = cx + r * Math.cos(angle)
        const y2 = cy + r * Math.sin(angle)
        const large = sweep > Math.PI ? 1 : 0
        return (
          <path
            key={i}
            d={`M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r},0,${large},1,${x2.toFixed(1)},${y2.toFixed(1)} Z`}
            fill={s.color}
            stroke="var(--bg-1)"
            strokeWidth={1.5}
          />
        )
      })}
    </svg>
  )
}

function ArtImg({ path, album, size, style = {} }) {
  const [ok, setOk] = React.useState(null)
  return (
    <div style={{ width: size, height: size, flexShrink: 0, overflow: 'hidden', background: 'var(--bg-3)', position: 'relative', ...style }}>
      <img
        src={`/api/art?path=${encodeURIComponent(path)}`}
        onLoad={() => setOk(true)}
        onError={() => setOk(false)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: ok ? 'block' : 'none' }}
        alt=""
      />
      {ok === false && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--f-display)', fontSize: 10, color: 'var(--ink-4)',
          textTransform: 'uppercase', textAlign: 'center', padding: 4, lineHeight: 1.1,
        }}>{album}</div>
      )}
    </div>
  )
}

function StatBlock({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 30, lineHeight: 1, color: accent || 'var(--ink)',
        letterSpacing: '-0.01em',
      }}>{value}</div>
    </div>
  )
}

export default function DashboardView({ onAddMusic }) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [tracks, setTracks] = React.useState([])
  const [libraryPath, setLibraryPath] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [bgUrls, setBgUrls] = React.useState([])
  const [fixState, setFixState] = React.useState(null)

  React.useEffect(() => {
    fetch('/api/library/tracks')
      .then(r => r.json())
      .then(({ tracks: t = [], libraryPath: lp = '' }) => {
        setTracks(t)
        setLibraryPath(lp)
        setLoading(false)

        // Pick one track per album (FLAC/MP3 only) for background art
        const seen = new Set()
        const urls = []
        for (const tr of t) {
          if (tr.fmt !== 'FLAC' && tr.fmt !== 'MP3') continue
          const key = `${tr.albumartist || tr.artist}__${tr.album}`
          if (seen.has(key)) continue
          seen.add(key)
          urls.push(`/api/art?path=${encodeURIComponent(tr.path)}`)
          if (urls.length >= 10) break
        }
        setBgUrls(urls)
      })
  }, [])

  const stats = React.useMemo(() => {
    if (!tracks.length) return null
    const artists = new Set(tracks.map(t => t.albumartist || t.artist).filter(Boolean))
    const albums  = new Set(tracks.map(t => `${t.albumartist || t.artist}__${t.album}`).filter(k => k !== '__'))
    const totalSecs  = tracks.reduce((a, t) => a + parseSecs(t.dur), 0)
    const totalBytes = tracks.reduce((a, t) => a + (t.file_size || 0), 0)

    // By format
    const byFmt = {}
    tracks.forEach(t => { byFmt[t.fmt] = (byFmt[t.fmt] || { count: 0, secs: 0, bytes: 0 }); byFmt[t.fmt].count++; byFmt[t.fmt].secs += parseSecs(t.dur); byFmt[t.fmt].bytes += (t.file_size || 0) })

    // Top artists by runtime
    const aMap = {}
    tracks.forEach(t => {
      const a = t.albumartist || t.artist; if (!a) return
      aMap[a] = aMap[a] || { secs: 0, count: 0, path: t.path }
      aMap[a].secs += parseSecs(t.dur); aMap[a].count++
    })
    const topArtists = Object.entries(aMap).sort((a, b) => b[1].secs - a[1].secs).slice(0, 10)

    // Genres
    const gMap = {}
    tracks.forEach(t => { if (t.genre) gMap[t.genre] = (gMap[t.genre] || 0) + 1 })
    const topGenres = Object.entries(gMap).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const otherGenreTracks = tracks.length - topGenres.reduce((a, [, n]) => a + n, 0)

    // By decade
    const dMap = {}
    tracks.forEach(t => { const yr = parseInt(t.date); if (yr > 1900) { const d = Math.floor(yr / 10) * 10; dMap[d] = (dMap[d] || 0) + 1 } })

    // Recently added albums (latest scanned_at per album)
    const albumMap = {}
    tracks.forEach(t => {
      const key = `${t.albumartist || t.artist}__${t.album}`
      // Use the earliest file birthtime in the album as "when it was added to the library"
      const bt = t.file_birthtime || 0
      if (!albumMap[key] || bt < albumMap[key]._birthtime) {
        albumMap[key] = { ...t, _birthtime: bt }
      }
    })
    const recentAlbums = Object.values(albumMap)
      .sort((a, b) => (b._birthtime || 0) - (a._birthtime || 0))
      .slice(0, 6)

    // Per-album health from track health_score
    const albumHealthMap = {}
    tracks.forEach(t => {
      const key = `${t.albumartist || t.artist}__${t.album}`
      if (!albumHealthMap[key]) albumHealthMap[key] = { albumartist: t.albumartist || t.artist, album: t.album, path: t.path, healths: [] }
      if (t.health !== null && t.health !== undefined) albumHealthMap[key].healths.push(t.health)
    })
    const unhealthyAlbums = Object.values(albumHealthMap)
      .filter(a => a.healths.length > 0)
      .map(a => ({ ...a, avgHealth: Math.round(a.healths.reduce((s, h) => s + h, 0) / a.healths.length) }))
      .filter(a => a.avgHealth < 100)
      .sort((a, b) => a.avgHealth - b.avgHealth)
      .slice(0, 10)

    return { artists: artists.size, albums: albums.size, totalSecs, totalBytes, byFmt, topArtists, topGenres, otherGenreTracks, dMap, recentAlbums, unhealthyAlbums }
  }, [tracks])

  const maxArtistSecs = stats?.topArtists[0]?.[1].secs || 1
  const maxDecadeCount = stats ? Math.max(...Object.values(stats.dMap)) : 1
  const fmtKeys = stats ? Object.keys(stats.byFmt).sort((a, b) => (stats.byFmt[b]?.count || 0) - (stats.byFmt[a]?.count || 0)) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)' }}>
      <TopNav active="dashboard" onAddMusic={onAddMusic} />

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── Hero ── */}
        <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg-1)', borderBottom: '1.5px solid var(--line)' }}>
          {/* Background art strip */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'stretch', pointerEvents: 'none', zIndex: 0,
          }}>
            {bgUrls.map((url, i) => (
              <img
                key={i} src={url} alt=""
                style={{ flex: 1, objectFit: 'cover', opacity: 0.10, filter: 'blur(1px) saturate(0.6)' }}
                onError={e => { e.target.style.display = 'none' }}
              />
            ))}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to right, var(--bg-1) 0%, oklch(0.17 0.01 270 / 0.7) 30%, oklch(0.17 0.01 270 / 0.7) 70%, var(--bg-1) 100%)',
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, transparent 40%, var(--bg-1) 100%)',
            }} />
          </div>

          {/* Hero content */}
          <div style={{ position: 'relative', zIndex: 1, padding: isMobile ? '16px 14px' : '24px 28px 20px' }}>
            {/* Stats strip */}
            {stats && (
              <div style={{ display: 'flex', gap: isMobile ? 16 : 32, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <StatBlock label="Artists" value={stats.artists} accent="var(--ink)" />
                <div style={{ width: 1, height: 40, background: 'var(--line)', alignSelf: 'center' }} />
                <StatBlock label="Albums" value={stats.albums} accent="var(--ink)" />
                <div style={{ width: 1, height: 40, background: 'var(--line)', alignSelf: 'center' }} />
                <StatBlock label="Tracks" value={tracks.length} accent="var(--ink)" />
                <div style={{ width: 1, height: 40, background: 'var(--line)', alignSelf: 'center' }} />
                <StatBlock label="Total Runtime" value={fmtDur(stats.totalSecs)} accent="var(--yellow)" />
                {stats.totalBytes > 0 && <>
                  <div style={{ width: 1, height: 40, background: 'var(--line)', alignSelf: 'center' }} />
                  <StatBlock label="On Disk" value={fmtBytes(stats.totalBytes)} accent="var(--pink)" />
                </>}
              </div>
            )}
            {loading && (
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-4)' }}>Loading library…</div>
            )}
          </div>
        </div>

        {stats && (
          <div style={{ padding: isMobile ? '12px' : '20px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 20 }}>

            {/* ── Main two-column grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 360px', gap: isMobile ? 12 : 20, alignItems: 'start' }}>

              {/* Left: Top Artists */}
              <div className="panel">
                <div className="panel-hd"><span className="title">Top Artists by Runtime</span></div>
                <div style={{ padding: '8px 0' }}>
                  {stats.topArtists.map(([name, a], i) => (
                    <div key={name} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '7px 14px',
                      borderBottom: i < stats.topArtists.length - 1 ? '1px solid var(--line-soft)' : 'none',
                    }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)', width: 20, textAlign: 'right' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <ArtImg path={a.path} album={name} size={36} />
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      {!isMobile && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 180px' }}>
                          <div style={{ flex: 1, height: 3, background: 'var(--bg-3)', position: 'relative' }}>
                            <div style={{
                              position: 'absolute', left: 0, top: 0, bottom: 0,
                              width: `${(a.secs / maxArtistSecs) * 100}%`,
                              background: i === 0 ? 'var(--pink)' : i === 1 ? 'var(--green)' : 'var(--cyan)',
                              transition: 'width 0.4s',
                            }} />
                          </div>
                          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-3)', width: 36, textAlign: 'right' }}>
                            {fmtDur(a.secs)}
                          </span>
                        </div>
                      )}
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: isMobile ? 11 : 10, color: isMobile ? 'var(--ink-3)' : 'var(--ink-4)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isMobile ? fmtDur(a.secs) : `${a.count} ${a.count === 1 ? 'track' : 'tracks'}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* By Format */}
                <div className="panel">
                  <div className="panel-hd"><span className="title">By Format</span>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                      {fmtKeys.length} formats in use
                    </span>
                  </div>
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Stacked bar — desktop only */}
                    {!isMobile && (
                      <div style={{ display: 'flex', height: 12, borderRadius: 0, overflow: 'hidden', border: '1px solid var(--line)' }}>
                        {fmtKeys.map(fmt => (
                          <div key={fmt} style={{
                            flex: stats.byFmt[fmt]?.count,
                            background: FMT_COLOR[fmt] || 'var(--ink-4)',
                          }} title={`${fmt}: ${stats.byFmt[fmt]?.count}`} />
                        ))}
                      </div>
                    )}
                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {fmtKeys.map(fmt => (
                        <span key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: FMT_COLOR[fmt] || 'var(--ink-4)' }}>
                          <span style={{ width: 8, height: 8, background: FMT_COLOR[fmt] || 'var(--ink-4)', display: 'inline-block' }} />
                          {fmt}
                        </span>
                      ))}
                    </div>
                    {/* Table */}
                    <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
                      {fmtKeys.map(fmt => {
                        const f = stats.byFmt[fmt]
                        return (
                          <div key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line-soft)' }}>
                            <span style={{ width: 8, height: 8, background: FMT_COLOR[fmt] || 'var(--ink-4)', flexShrink: 0 }} />
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 700, color: FMT_COLOR[fmt] || 'var(--ink-3)', width: 36 }}>{fmt}</span>
                            <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: 1 }}>{f.count} tracks</span>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)' }}>{fmtDur(f.secs)}</span>
                            {f.bytes > 0 && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)', width: 52, textAlign: 'right' }}>{fmtBytes(f.bytes)}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Genres */}
                <div className="panel">
                  <div className="panel-hd"><span className="title">Genres</span></div>
                  <div style={{ padding: '12px 14px', display: 'flex', gap: 14, alignItems: 'center' }}>
                    {!isMobile && (
                      <PieChart
                        slices={[
                          ...stats.topGenres.map(([, n], i) => ({ value: n, color: GENRE_COLORS[i] })),
                          ...(stats.otherGenreTracks > 0 ? [{ value: stats.otherGenreTracks, color: 'var(--bg-3)' }] : []),
                        ]}
                      />
                    )}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {stats.topGenres.map(([name, count], i) => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, background: GENRE_COLORS[i], flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)', textAlign: 'right' }}>
                            {count} · {Math.round(count / tracks.length * 100)}%
                          </span>
                        </div>
                      ))}
                      {stats.otherGenreTracks > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, background: 'var(--bg-3)', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--ink-4)', flex: 1 }}>Other</span>
                          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                            {stats.otherGenreTracks} · {Math.round(stats.otherGenreTracks / tracks.length * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* ── Recently Added ── */}
            <div className="panel">
              <div className="panel-hd">
                <span className="title">Recently Added</span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                  {stats.albums} of {stats.albums} albums
                </span>
              </div>
              <div style={{ padding: '14px', display: 'flex', gap: 14, overflowX: 'auto' }}>
                {stats.recentAlbums.map((t, i) => {
                  const year = t.date ? t.date.slice(0, 4) : null
                  return (
                    <div key={i} style={{ flexShrink: 0, width: isMobile ? 110 : 140, cursor: 'pointer' }} onClick={() => navigate(`/tree?artist=${encodeURIComponent(splitArtists(t.albumartist || t.artist)[0])}&album=${encodeURIComponent(t.album)}`)}>
                      <div style={{ position: 'relative' }}>
                        <ArtImg path={t.path} album={t.album} size={isMobile ? 110 : 140} style={{ border: '1.5px solid var(--line)' }} />
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.album || 'Unknown Album'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.albumartist || t.artist}
                        </div>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                          {year}{year ? ' · ' : ''}{fmtAge(t.file_birthtime || t.scanned_at)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Bottom row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 12 : 20, alignItems: 'start' }}>

              {/* Catalog by Decade */}
              <div className="panel">
                <div className="panel-hd"><span className="title">Catalog by Decade</span>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)' }}>Album release years</span>
                </div>
                <div style={{ padding: '16px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 80 }}>
                    {Object.entries(stats.dMap).sort((a, b) => a[0] - b[0]).map(([decade, count]) => (
                      <div key={decade} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-4)' }}>{count}</span>
                        <div style={{
                          width: '100%',
                          height: `${(count / maxDecadeCount) * 64}px`,
                          background: 'var(--green)',
                          opacity: 0.7 + (count / maxDecadeCount) * 0.3,
                        }} />
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-3)' }}>{decade}s</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Library Health */}
              <div className="panel">
                <div className="panel-hd">
                  <span className="title">Library Health</span>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: stats.unhealthyAlbums.length > 0 ? 'var(--yellow)' : 'var(--green)' }}>
                    {stats.unhealthyAlbums.length > 0 ? `${stats.unhealthyAlbums.length} album${stats.unhealthyAlbums.length !== 1 ? 's' : ''} need attention` : 'All good'}
                  </span>
                </div>
                {stats.unhealthyAlbums.length === 0 ? (
                  <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--f-mono)' }}>
                    ✓ All albums at 100% health
                  </div>
                ) : (
                  <div>
                    {stats.unhealthyAlbums.map((a, i) => {
                      const color = a.avgHealth >= 90 ? 'var(--green)' : a.avgHealth >= 60 ? 'var(--yellow)' : 'var(--pink)'
                      const albumTracks = tracks.filter(t => (t.albumartist || t.artist) === a.albumartist && t.album === a.album)
                      const albumPaths = albumTracks.map(t => t.path).filter(Boolean)
                      return (
                        <div
                          key={i}
                          onClick={() => albumPaths.length > 0 && setFixState({ paths: albumPaths, scope: 'album', albumName: a.album })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 14px',
                            borderBottom: i < stats.unhealthyAlbums.length - 1 ? '1px solid var(--line-soft)' : 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <ArtImg path={a.path} album={a.album} size={36} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.album || 'Unknown Album'}</div>
                            <div style={{ fontSize: 10, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.albumartist}</div>
                          </div>
                          <span style={{
                            fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 700,
                            color,
                            width: 44, textAlign: 'right', flexShrink: 0,
                          }}>{a.avgHealth}%</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {!loading && !stats && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, marginBottom: 12 }}>LIBRARY EMPTY</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>Configure a library path in Settings, then scan.</div>
            <button className="btn primary" onClick={() => navigate('/settings')}>Open Settings</button>
          </div>
        )}
      </div>

      <StatusBar
        left={stats ? `${stats.artists} artists · ${stats.albums} albums · ${tracks.length} tracks · ${fmtDur(stats.totalSecs)}` : 'No library'}
        right={libraryPath || ''}
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
