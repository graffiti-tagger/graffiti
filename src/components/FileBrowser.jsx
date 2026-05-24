import React from 'react'

const useLs = (path, showHidden) => {
  const [state, setState] = React.useState({ data: null, loading: true, error: null })
  React.useEffect(() => {
    setState({ data: null, loading: true, error: null })
    const params = new URLSearchParams({ path, showHidden: String(showHidden) })
    fetch(`/api/fs/ls?${params}`)
      .then(async r => {
        const text = await r.text()
        if (!text) throw new Error('No response from server — is the backend running?')
        const json = JSON.parse(text)
        if (!r.ok) throw new Error(json.error || `Server error ${r.status}`)
        return json
      })
      .then(data => setState({ data, loading: false, error: null }))
      .catch(e => setState({ data: null, loading: false, error: e.message }))
  }, [path, showHidden])
  return state
}

// mode: "dir" — pick a directory; "file" — pick a file
export const FileBrowser = ({ initialPath, mode = 'dir', onSelect, onClose }) => {
  const [currentPath, setCurrentPath] = React.useState(initialPath || '/')
  const [showHidden, setShowHidden] = React.useState(false)
  const [selectedPath, setSelectedPath] = React.useState(initialPath || null)
  const { data, loading, error } = useLs(currentPath, showHidden)

  const navigate = p => {
    setCurrentPath(p)
    if (mode === 'dir') setSelectedPath(p)
  }

  const handleEntryClick = entry => {
    if (entry.isDir) {
      if (mode === 'dir') setSelectedPath(entry.path)
      else navigate(entry.path)
    } else {
      if (mode === 'file') setSelectedPath(entry.path)
    }
  }

  const handleEntryDoubleClick = entry => {
    if (entry.isDir) navigate(entry.path)
  }

  // Breadcrumb segments
  const segments = currentPath.split('/').filter(Boolean)
  const crumbs = segments.map((seg, i) => ({
    label: seg,
    path: '/' + segments.slice(0, i + 1).join('/'),
  }))

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'oklch(0 0 0 / 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '70vh',
          background: 'var(--bg-1)',
          border: '1.5px solid var(--green)',
          boxShadow: '6px 6px 0 var(--pink)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1.5px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '0.06em' }}>
            {mode === 'dir' ? 'SELECT FOLDER' : 'SELECT FILE'}
          </span>
          <span style={{ flex: 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={e => setShowHidden(e.target.checked)}
              style={{ accentColor: 'var(--green)' }}
            />
            show hidden
          </label>
        </div>

        {/* Breadcrumb */}
        <div style={{
          padding: '6px 16px',
          borderBottom: '1px solid var(--line-soft)',
          fontFamily: 'var(--f-mono)', fontSize: 11,
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
          color: 'var(--ink-3)',
        }}>
          <span
            onClick={() => navigate('/')}
            style={{ cursor: 'pointer', color: 'var(--cyan)' }}
          >/</span>
          {crumbs.map((c, i) => (
            <React.Fragment key={c.path}>
              <span
                onClick={() => navigate(c.path)}
                style={{
                  cursor: 'pointer',
                  color: i === crumbs.length - 1 ? 'var(--ink)' : 'var(--cyan)',
                  fontWeight: i === crumbs.length - 1 ? 700 : 400,
                }}
              >{c.label}</span>
              {i < crumbs.length - 1 && <span>/</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Entry list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {loading && (
            <div style={{ padding: '16px', color: 'var(--ink-3)', fontSize: 12 }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: '16px', color: 'var(--pink)', fontSize: 12 }}>{error}</div>
          )}
          {data && (
            <>
              {data.parent && (
                <div
                  onClick={() => navigate(data.parent)}
                  style={rowStyle(false)}
                >
                  <span style={{ color: 'var(--ink-3)' }}>↑</span>
                  <span style={{ color: 'var(--ink-3)' }}>..</span>
                </div>
              )}
              {data.entries.map(entry => {
                const isSelected = entry.path === selectedPath
                const dimmed = mode === 'dir' && !entry.isDir
                return (
                  <div
                    key={entry.path}
                    onClick={() => handleEntryClick(entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    style={{
                      ...rowStyle(isSelected),
                      opacity: dimmed ? 0.35 : 1,
                      cursor: dimmed ? 'default' : 'pointer',
                    }}
                  >
                    <span style={{ color: entry.isDir ? 'var(--cyan)' : 'var(--ink-3)', fontSize: 14 }}>
                      {entry.isDir ? '▸' : '·'}
                    </span>
                    <span style={{
                      fontFamily: 'var(--f-mono)', fontSize: 12,
                      color: isSelected ? 'oklch(0.15 0 0)' : entry.isDir ? 'var(--ink)' : 'var(--ink-2)',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.name}
                    </span>
                  </div>
                )
              })}
              {data.entries.length === 0 && (
                <div style={{ padding: '16px', color: 'var(--ink-4)', fontSize: 12 }}>Empty directory</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1.5px solid var(--line)',
          background: 'var(--bg-2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            fontFamily: 'var(--f-mono)', fontSize: 11,
            color: 'var(--ink-3)', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {selectedPath || <span style={{ color: 'var(--ink-4)' }}>nothing selected</span>}
          </span>
          <button className="btn sm" onClick={onClose}>Cancel</button>
          <button
            className="btn primary sm"
            disabled={!selectedPath}
            onClick={() => selectedPath && onSelect(selectedPath)}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  )
}

const rowStyle = selected => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '5px 16px',
  background: selected ? 'var(--green)' : 'transparent',
  cursor: 'pointer',
})
