import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useIsMobile } from '../hooks/useBreakpoint.js'

export const Wordmark = ({ size = 22, tilt = -2 }) => (
  <span className="wordmark" style={{ fontSize: size, transform: `rotate(${tilt}deg)`, lineHeight: 1 }}>
    Graffiti<span style={{ color: "var(--green)", marginLeft: 4 }}>Tagger</span>
  </span>
)

export const SprayCan = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="9" y="11" width="14" height="18" rx="1" fill="var(--bg-3)" stroke="var(--ink)" strokeWidth="1.5"/>
    <rect x="11" y="6" width="10" height="4" fill="var(--ink-2)" stroke="var(--ink)" strokeWidth="1.5"/>
    <rect x="13" y="3" width="6" height="3" fill="var(--pink)" stroke="var(--ink)" strokeWidth="1.5"/>
    <rect x="11" y="15" width="10" height="3" fill="var(--green)"/>
  </svg>
)

const NavDrawer = ({ items, active, onClose, pendingCount, onCommit, onAddMusic, navigate }) => (
  <>
    {/* Backdrop */}
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'oklch(0 0 0 / 0.55)',
      }}
    />
    {/* Drawer panel */}
    <div style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: 260, zIndex: 201,
      background: 'var(--bg-1)', borderRight: '2px solid var(--line)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        height: 52, padding: '0 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1.5px solid var(--line)', flex: '0 0 auto',
      }}>
        <SprayCan size={20} />
        <Wordmark size={18} />
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, padding: '4px 6px' }}
        >✕</button>
      </div>

      {/* Nav links */}
      <div style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {items.map(it => (
          <div
            key={it.id}
            onClick={() => { navigate(it.path); onClose() }}
            style={{
              padding: '12px 20px',
              fontSize: 13, fontWeight: it.id === active ? 700 : 500,
              background: it.id === active ? 'var(--green)' : 'transparent',
              color: it.id === active ? 'oklch(0.15 0 0)' : 'var(--ink-2)',
              borderLeft: it.id === active ? '3px solid var(--ink)' : '3px solid transparent',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >{it.label}</div>
        ))}
      </div>

      {/* Footer actions */}
      <div style={{ padding: '12px 16px', borderTop: '1.5px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn primary sm" onClick={() => { onAddMusic(); onClose() }} style={{ width: '100%' }}>
          + Add Music
        </button>
        {pendingCount > 0 && (
          <button className="btn primary sm" onClick={() => { onCommit(); onClose() }} style={{ width: '100%' }}>
            COMMIT CHANGES ({pendingCount})
          </button>
        )}
      </div>
    </div>
  </>
)

export const TopNav = ({ active, pendingCount = 0, onCommit, onAddMusic }) => {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const items = [
    { id: "dashboard", label: "Dashboard", path: "/dashboard" },
    { id: "tree",      label: "Library",   path: "/tree" },
    { id: "grid",      label: "Grid",      path: "/grid" },
    { id: "settings",  label: "Settings",  path: "/settings" },
  ]

  if (isMobile) {
    return (
      <>
        <div style={{
          height: 52, padding: '0 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--bg-1)',
          borderBottom: '1.5px solid var(--line)',
          flex: '0 0 auto',
        }}>
          {/* Hamburger */}
          <button
            onClick={() => setDrawerOpen(true)}
            style={{
              position: 'relative',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--ink)', fontSize: 20, padding: '4px 6px',
              lineHeight: 1,
            }}
          >
            ☰
            {pendingCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 0,
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--pink)', border: '1.5px solid var(--bg-1)',
              }} />
            )}
          </button>
          <SprayCan size={20} />
          <Wordmark size={17} />
          <span style={{ flex: 1 }} />
          <button className="btn primary sm" onClick={onAddMusic} style={{ fontSize: 12, padding: '4px 12px' }}>
            + Add
          </button>
        </div>
        {drawerOpen && (
          <NavDrawer
            items={items} active={active}
            onClose={() => setDrawerOpen(false)}
            pendingCount={pendingCount} onCommit={onCommit} onAddMusic={onAddMusic}
            navigate={navigate}
          />
        )}
      </>
    )
  }

  return (
    <div style={{
      height: 52, padding: "0 18px",
      display: "flex", alignItems: "center", gap: 18,
      background: "var(--bg-1)",
      borderBottom: "1.5px solid var(--line)",
      flex: "0 0 auto",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SprayCan />
        <Wordmark size={22} tilt={-2} />
      </div>
      <div style={{ width: 1, height: 24, background: "var(--line)" }} />
      <div style={{ display: "flex", gap: 2 }}>
        {items.map(it => (
          <span key={it.id} onClick={() => navigate(it.path)} style={{
            padding: "6px 12px",
            fontSize: 12, fontWeight: it.id === active ? 700 : 500,
            background: it.id === active ? "var(--green)" : "transparent",
            color: it.id === active ? "oklch(0.15 0 0)" : "var(--ink-2)",
            border: it.id === active ? "1.5px solid var(--ink)" : "1.5px solid transparent",
            boxShadow: it.id === active ? "2px 2px 0 var(--pink)" : "none",
            cursor: "pointer",
          }}>{it.label}</span>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button className="btn primary sm" onClick={onAddMusic} style={{ fontSize: 11, padding: '4px 12px' }}>
        + Add Music
      </button>
      {pendingCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="sticker pink" style={{ fontSize: 11 }}>● {pendingCount} PENDING</span>
          <button className="btn primary sm" onClick={onCommit}>COMMIT CHANGES</button>
        </div>
      )}
    </div>
  )
}

export const StatusBar = ({ left, right }) => {
  const isMobile = useIsMobile()
  if (isMobile) return null
  return (
    <div style={{
      height: 26, padding: "0 14px",
      background: "var(--bg-1)",
      borderTop: "1.5px solid var(--line)",
      display: "flex", alignItems: "center", gap: 14,
      fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)",
      flex: "0 0 auto",
    }}>
      <span><span style={{ color: "var(--green)" }}>●</span> ready</span>
      <span style={{ color: "var(--ink-4)" }}>│</span>
      <span>{left}</span>
      <span style={{ flex: 1 }} />
      <span>{right}</span>
    </div>
  )
}

export const Pill = ({ children, accent }) => {
  const c = accent === "green" ? "var(--green)" : accent === "cyan" ? "var(--cyan)" : accent === "pink" ? "var(--pink)" : accent === "yellow" ? "var(--yellow)" : "var(--ink-3)"
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      color: c, border: `1px solid ${c}`,
      padding: "1px 6px",
      display: "inline-block",
    }}>{children}</span>
  )
}
