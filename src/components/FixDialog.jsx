import React from 'react'
import ProcessPanel from './ProcessPanel.jsx'
import { TAG_BY_KEY } from '../data/tags.js'

const TAG_LABEL = key => {
  if (key === 'cover_art') return 'Cover Art'
  return TAG_BY_KEY[key]?.label ?? key
}

// Apply tags to a library file via PUT /api/tags
async function applyLibraryTags(filePath, tags) {
  const res = await fetch(`/api/tags?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tags),
  })
  if (!res.ok && res.status !== 204) {
    const e = await res.json().catch(() => ({}))
    throw new Error(`${filePath.split('/').pop()}: ${e.error ?? `HTTP ${res.status}`}`)
  }
}

// ─── FixDialog ────────────────────────────────────────────────────────────────
//
// Props:
//   paths     string[]      — library file paths to fix
//   scope     'track'|'album'
//   albumName string        — display name for the header
//   onClose   () => void

const FixDialog = ({ paths, scope, albumName, onClose }) => {
  const [activePaths, setActivePaths] = React.useState(new Set(paths))
  const [fixComplete, setFixComplete] = React.useState(false)
  const [completedCount, setCompletedCount] = React.useState(0)
  const [issues, setIssues] = React.useState(null) // null = loading

  React.useEffect(() => {
    fetch('/api/library/health-issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
      .then(r => r.json())
      .then(data => setIssues(data.issues ?? []))
      .catch(() => setIssues([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFixComplete = React.useCallback(async (donePaths) => {
    setCompletedCount(donePaths.length)
    await fetch('/api/library/recompute-health', { method: 'POST' }).catch(() => {})
    window.dispatchEvent(new CustomEvent('gt:library-refresh'))
    setFixComplete(true)
  }, [])

  const togglePath = (p) => setActivePaths(prev => {
    const next = new Set(prev)
    if (next.has(p)) next.delete(p); else next.add(p)
    return next
  })

  const headerLabel = albumName
    ? `FIX — ${albumName}`
    : scope === 'album' ? 'FIX ALBUM' : 'FIX TRACK'

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(92vw, 1200px)', height: 'min(90vh, 820px)',
          background: 'var(--bg-1)', border: '2px solid var(--line)',
          boxShadow: '4px 4px 0 var(--cyan)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '0 16px', height: 48, display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid var(--line)', flex: '0 0 auto', background: 'var(--bg-2)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 14, letterSpacing: '0.04em' }}>{headerLabel}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>
            {paths.length} track{paths.length !== 1 ? 's' : ''}
          </span>
          {issues !== null && issues.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--yellow)', fontFamily: 'var(--f-mono)' }}>
              · {issues.length} issue{issues.length !== 1 ? 's' : ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ padding: '3px 10px', fontSize: 11 }}>✕ Close</button>
        </div>

        {fixComplete ? (
          /* Success state */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{ fontSize: 52, color: 'var(--cyan)', lineHeight: 1 }}>✓</div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.06em' }}>FIX COMPLETE</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {completedCount} track{completedCount !== 1 ? 's' : ''} processed · library health updated
            </div>
            <button className="btn primary" onClick={onClose} style={{ marginTop: 8, padding: '8px 24px' }}>
              Close
            </button>
          </div>
        ) : (
          /* Two-column layout: left panel + process panel */
          <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--bg-0)' }}>
            {/* Left: issues + track list */}
            <div style={{ width: 260, borderRight: '1.5px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-1)' }}>

              {/* Issues section */}
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', flex: '0 0 auto' }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
                  Issues
                </div>
                {issues === null ? (
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>Loading…</div>
                ) : issues.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span>✓</span> All mandatory tags present
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {issues.map(issue => {
                      const allMissing = issue.missing === issue.total
                      const color = allMissing ? 'var(--pink)' : 'var(--yellow)'
                      return (
                        <div key={issue.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color, fontSize: 10, flexShrink: 0 }}>●</span>
                          <span style={{ fontSize: 12, flex: 1, color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {TAG_LABEL(issue.key)}
                          </span>
                          <span style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink-4)', flexShrink: 0 }}>
                            {issue.missing}{issue.total > 1 ? `/${issue.total}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Track list (with checkboxes for multi-track album) */}
              {paths.length > 1 && (
                <>
                  <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--line-soft)', fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                    <span style={{ flex: 1 }}>Tracks to fix</span>
                    <button className="btn ghost" onClick={() => setActivePaths(new Set(paths))} style={{ padding: '1px 6px', fontSize: 10 }}>All</button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {paths.map(p => {
                      const filename = p.split('/').pop() ?? p
                      const active = activePaths.has(p)
                      return (
                        <div
                          key={p}
                          onClick={() => togglePath(p)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '5px 12px',
                            borderBottom: '1px solid var(--line-soft)',
                            background: active ? 'color-mix(in oklch, var(--cyan) 8%, transparent)' : 'transparent',
                            cursor: 'pointer', userSelect: 'none',
                          }}
                        >
                          <input type="checkbox" checked={active} onChange={() => {}} onClick={e => e.stopPropagation()}
                            style={{ accentColor: 'var(--cyan)', flex: '0 0 auto', pointerEvents: 'none' }} />
                          <span style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {filename}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Right: process panel */}
            <ProcessPanel
              selected={activePaths}
              endpoint="/api/library/fix"
              replaygainEndpoint="/api/library/replaygain"
              mode="fix"
              albumScope={scope === 'album'}
              showRgWarning={scope === 'track'}
              applyTagsFn={applyLibraryTags}
              onFixComplete={handleFixComplete}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default FixDialog
