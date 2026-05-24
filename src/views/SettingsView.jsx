import React from 'react'
import { TopNav, StatusBar } from '../components/shell.jsx'
import { FileBrowser } from '../components/FileBrowser.jsx'
import { PATH_PLACEHOLDER_TAGS, TAG_GROUPS, TAGS_BY_GROUP } from '../data/tags.js'
import { useIsMobile } from '../hooks/useBreakpoint.js'

const SettingRow = ({ label, hint, children, style }) => {
  const isMobile = useIsMobile()
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: isMobile ? 6 : 24, padding: "14px 0", borderBottom: "1px solid var(--line-soft)", ...style }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

const Toggle = ({ on, onChange, disabled }) => (
  <span onClick={() => !disabled && onChange(!on)} style={{
    display: "inline-block", width: 42, height: 22,
    background: on ? "var(--green)" : "var(--bg-3)",
    border: "1.5px solid var(--line)",
    position: "relative", cursor: "pointer",
  }}>
    <span style={{
      position: "absolute", top: 1, left: on ? 21 : 1,
      width: 16, height: 16,
      background: "var(--ink)",
      transition: "left 120ms",
    }} />
  </span>
)

const TAG_MODE_COLOR = {
  mandatory: 'var(--green)',
  optional:  'var(--cyan)',
  ignored:   'var(--ink-3)',
}

const TagModeToggle = ({ tagKey, value, onChange, readOnly }) => {
  const opts = tagKey === 'cover_art'
    ? ['mandatory', 'optional']
    : readOnly
      ? ['optional', 'ignored']
      : ['mandatory', 'optional', 'ignored']
  return (
    <div style={{ display: 'inline-flex', border: '1.5px solid var(--line)', flexShrink: 0 }}>
      {opts.map((opt, i) => {
        const active = value === opt
        return (
          <button key={opt} onClick={() => onChange(opt)} style={{
            padding: '3px 11px', fontSize: 11, fontWeight: active ? 700 : 400,
            letterSpacing: '0.04em',
            background: active ? TAG_MODE_COLOR[opt] : 'var(--bg-2)',
            color: active ? 'oklch(0.12 0 0)' : 'var(--ink-3)',
            border: 'none',
            borderLeft: i > 0 ? '1px solid var(--line)' : 'none',
            cursor: 'pointer',
          }}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</button>
        )
      })}
    </div>
  )
}

const PathField = ({ value, onChange, mode = "dir" }) => {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="field path"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button className="btn" onClick={() => setOpen(true)}>Browse…</button>
      </div>
      {open && (
        <FileBrowser
          initialPath={value}
          mode={mode}
          onSelect={p => { onChange(p); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const TOOLS = [
  { key: "metaflac",      label: "metaflac",      desc: "FLAC tag I/O"           },
  { key: "vorbiscomment", label: "vorbiscomment",  desc: "OGG Vorbis tag I/O"     },
  { key: "AtomicParsley", label: "AtomicParsley",  desc: "M4A / AAC atom I/O"     },
  { key: "fpcalc",        label: "fpcalc",         desc: "AcoustID fingerprinter" },
  { key: "rsgain",        label: "rsgain",         desc: "ReplayGain calculator"  },
  { key: "ffprobe",       label: "ffprobe",        desc: "Audio stream analysis"  },
  { key: "ffmpeg",        label: "ffmpeg",         desc: "Audio decoding / spectral analysis" },
]

const EXAMPLE_VALUES = {
  "%albumartist%": "Bad Brains", "%artist%": "Bad Brains",
  "%album%": "Bad Brains", "%date%": "1982",
  "%tracknumber%": "03", "%title%": "Attitude",
  "%genre%": "Hardcore Punk", "%extension%": "flac",
}

const SettingsView = ({ onAddMusic }) => {
  const isMobile = useIsMobile()
  const [config, setConfig] = React.useState(null)
  const [saveState, setSaveState] = React.useState("idle") // idle | saving | saved | error
  const [section, setSection] = React.useState("folders")
  const [mobileShowContent, setMobileShowContent] = React.useState(false)

  const userChanged = React.useRef(false)
  const saveTimer = React.useRef(null)

  // Load on mount
  React.useEffect(() => {
    fetch('/api/settings')
      .then(async r => {
        const text = await r.text()
        if (!text) throw new Error('empty')
        return JSON.parse(text)
      })
      .then(setConfig)
      .catch(() => setSaveState("error"))
  }, [])

  // Auto-save on change (debounced, skips initial load)
  React.useEffect(() => {
    if (!config || !userChanged.current) return
    setSaveState("saving")
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
        .then(() => {
          setSaveState("saved")
          setTimeout(() => setSaveState("idle"), 2000)
          if (tagSettingsChanged.current) {
            tagSettingsChanged.current = false
            setRecomputingHealth(true)
            fetch('/api/library/recompute-health', { method: 'POST' })
              .finally(() => setRecomputingHealth(false))
          }
        })
        .catch(() => setSaveState("error"))
    }, 800)
    return () => clearTimeout(saveTimer.current)
  }, [config])

  // All user-driven updates go through these helpers so we know to save
  const set = key => value => {
    userChanged.current = true
    setConfig(c => ({ ...c, [key]: value }))
  }
  const setMb = key => value => {
    userChanged.current = true
    setConfig(c => ({ ...c, musicbrainz: { ...c.musicbrainz, [key]: value } }))
  }
  const setBin = key => value => {
    userChanged.current = true
    setConfig(c => ({ ...c, bins: { ...c.bins, [key]: value } }))
  }
  const setTagSetting = (key, value) => {
    userChanged.current = true
    tagSettingsChanged.current = true
    setConfig(c => ({ ...c, tagSettings: { ...c.tagSettings, [key]: value } }))
  }
  const setGroupTagSettings = (groupKey, value) => {
    const tags = TAGS_BY_GROUP[groupKey] ?? []
    userChanged.current = true
    tagSettingsChanged.current = true
    setConfig(c => {
      const next = { ...c.tagSettings }
      for (const t of tags) {
        if (value === 'mandatory' && t.readOnly) continue
        next[t.key] = value
      }
      return { ...c, tagSettings: next }
    })
  }

  const [rebuilding, setRebuilding] = React.useState(false)
  const [rebuildResult, setRebuildResult] = React.useState(null)
  const rebuildPollTimer = React.useRef(null)

  const pollRebuildStatus = React.useCallback(() => {
    fetch('/api/library/rebuild/status')
      .then(r => r.json())
      .then(status => {
        if (status.running) {
          setRebuilding(true)
          rebuildPollTimer.current = setTimeout(pollRebuildStatus, 2000)
        } else {
          setRebuilding(false)
          if (status.result) setRebuildResult(status.result)
        }
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    fetch('/api/library/rebuild/status')
      .then(r => r.json())
      .then(status => {
        if (status.running) {
          setRebuilding(true)
          rebuildPollTimer.current = setTimeout(pollRebuildStatus, 2000)
        } else if (status.result) {
          setRebuildResult(status.result)
        }
      })
      .catch(() => {})
    return () => clearTimeout(rebuildPollTimer.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [toolStatus, setToolStatus] = React.useState(null)
  const recheckTimer = React.useRef(null)
  const [recomputingHealth, setRecomputingHealth] = React.useState(false)
  const [removeIgnoredRunning, setRemoveIgnoredRunning] = React.useState(false)
  const [removeIgnoredResult, setRemoveIgnoredResult] = React.useState(null)
  const tagSettingsChanged = React.useRef(false)

  const recheckTools = React.useCallback(() => {
    fetch('/api/tools/status')
      .then(r => r.json())
      .then(setToolStatus)
      .catch(() => setToolStatus({}))
  }, [])

  const setBinAndCheck = key => value => {
    setBin(key)(value)
    setToolStatus(prev => prev ? { ...prev, [key]: null } : prev)
    clearTimeout(recheckTimer.current)
    recheckTimer.current = setTimeout(recheckTools, 700)
  }

  React.useEffect(() => {
    if (section !== "tools") return
    setToolStatus(null)
    fetch('/api/tools/status')
      .then(r => r.json())
      .then(setToolStatus)
      .catch(() => setToolStatus({}))
  }, [section])

  const rebuildLibrary = async () => {
    setRebuilding(true)
    setRebuildResult(null)
    try {
      await fetch('/api/library/rebuild', { method: 'POST' })
      pollRebuildStatus()
    } catch (e) {
      setRebuildResult({ error: e.message })
      setRebuilding(false)
    }
  }

  const sections = [
    { id: "folders",    label: "Folders" },
    { id: "naming",     label: "Path & Naming" },
    { id: "mb",         label: "Web Services" },
    { id: "processing", label: "Processing" },
    { id: "tags",       label: "Tags" },
    { id: "tools",      label: "Backend Tools" },
    { id: "appearance", label: "Appearance" },
  ]

  const placeholders = [...PATH_PLACEHOLDER_TAGS.map(t => t.placeholder), "%extension%"]

  const statusRight = saveState === "saving" ? "Saving…"
    : saveState === "saved"  ? "Saved ✓"
    : saveState === "error"  ? "Save failed — is the backend running?"
    : "Auto-saved"

  if (!config) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      <TopNav active="settings" pendingCount={0} onAddMusic={onAddMusic} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13 }}>
        {saveState === "error"
          ? <span style={{ color: "var(--pink)" }}>Could not load settings — is the backend running?</span>
          : "Loading settings…"}
      </div>
      <StatusBar left="Section: settings" right={statusRight} />
    </div>
  )

  const examplePath = placeholders.reduce(
    (s, p) => s.replaceAll(p, EXAMPLE_VALUES[p] ?? p.slice(1, -1)),
    config.pathTemplate
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      <TopNav active="settings" pendingCount={0} onAddMusic={onAddMusic} />

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* Section nav — desktop sidebar or mobile full-screen list */}
        {(!isMobile || !mobileShowContent) && (
          <div style={isMobile
            ? { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-1)" }
            : { width: 220, flex: "0 0 220px", borderRight: "1.5px solid var(--line)", background: "var(--bg-1)", padding: "16px 0" }
          }>
            {!isMobile && <div className="label" style={{ padding: "0 16px 8px" }}>Settings</div>}
            {isMobile && <div style={{ padding: "14px 16px 6px", fontFamily: "var(--f-display)", fontSize: 13, letterSpacing: "0.06em", borderBottom: "1.5px solid var(--line)" }}>SETTINGS</div>}
            <div style={isMobile ? { flex: 1, overflowY: "auto" } : {}}>
              {sections.map(s => (
                <div key={s.id} onClick={() => { setSection(s.id); if (isMobile) setMobileShowContent(true) }} style={{
                  padding: isMobile ? "14px 20px" : "8px 16px",
                  fontSize: 13, fontWeight: section === s.id && !isMobile ? 700 : 500,
                  background: section === s.id && !isMobile ? "color-mix(in oklch, var(--green) 12%, transparent)" : "transparent",
                  borderLeft: section === s.id && !isMobile ? "3px solid var(--green)" : "3px solid transparent",
                  borderBottom: isMobile ? "1px solid var(--line-soft)" : "none",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  {s.label}
                  {isMobile && <span style={{ color: "var(--ink-4)", fontSize: 16 }}>›</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section content — desktop always, mobile only when showing content */}
        {(!isMobile || mobileShowContent) && (
        <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "0" : "28px 36px" }}>
          {isMobile && (
            <button
              onClick={() => setMobileShowContent(false)}
              style={{
                display: "block", width: "100%", padding: "10px 16px", textAlign: "left",
                background: "var(--bg-1)", border: "none",
                borderBottom: "1.5px solid var(--line)",
                color: "var(--ink-2)", fontSize: 13, cursor: "pointer",
                flex: "0 0 auto",
              }}
            >← Settings</button>
          )}
          <div style={{ padding: isMobile ? "16px 14px" : "0" }}>
          <div style={{ marginBottom: 24 }}>
            <div className="label">Settings</div>
            <h1 style={{ margin: "4px 0 0", fontFamily: "var(--f-display)", fontSize: 32, lineHeight: 1 }}>
              {section === "folders"    && <>SET YOUR <span style={{ color: "var(--green)" }}>CRATES</span></>}
              {section === "naming"     && <>PATH <span style={{ color: "var(--cyan)" }}>STENCIL</span></>}
              {section === "mb"         && <>WEB <span style={{ color: "var(--pink)" }}>SERVICES</span></>}
              {section === "processing" && <>PROCESS<span style={{ color: "var(--yellow)" }}>ING</span></>}
              {section === "tags"       && <>TAG <span style={{ color: "var(--yellow)" }}>SETTINGS</span></>}
              {section === "tools"      && <>BACKEND <span style={{ color: "var(--cyan)" }}>TOOLS</span></>}
              {section === "appearance" && <>LOOK & <span style={{ color: "var(--green)" }}>FEEL</span></>}
            </h1>
          </div>

          {section === "folders" && (
            <div style={{ maxWidth: isMobile ? '100%' : 760 }}>
              <SettingRow label="Library folder" hint="Master collection. Promoted files live here.">
                <PathField value={config.libraryPath} onChange={set("libraryPath")} mode="dir" />
              </SettingRow>
              <SettingRow label="Inbox folder" hint="Staging area for incoming, unverified files.">
                <PathField value={config.inboxPath} onChange={set("inboxPath")} mode="dir" />
              </SettingRow>
              <SettingRow label="Backup folder" hint="Originals copied here before any tag write.">
                <PathField value={config.backupPath} onChange={set("backupPath")} mode="dir" />
              </SettingRow>
              <SettingRow label="Watch folders" hint="Auto-add new files dropped here to the inbox.">
                <Toggle on={config.watchFolders} onChange={set("watchFolders")} />
              </SettingRow>
              <SettingRow
                label="Rebuild library"
                hint="Clears the database and re-reads all tags from disk. Use this to fix duplicates or stale data."
                style={{ marginTop: 8 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button className="btn" onClick={rebuildLibrary} disabled={rebuilding}>
                    {rebuilding ? "Rebuilding…" : "Rebuild now"}
                  </button>
                  {rebuildResult && (
                    <span style={{ fontSize: 12, color: rebuildResult.error ? "var(--pink)" : "var(--green)" }}>
                      {rebuildResult.error
                        ? `Error: ${rebuildResult.error}`
                        : `Done — ${rebuildResult.added} added, ${rebuildResult.skipped} unchanged in ${(rebuildResult.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </div>
              </SettingRow>
            </div>
          )}

          {section === "naming" && (
            <div style={{ maxWidth: isMobile ? '100%' : 820 }}>
              <SettingRow label="Path template" hint="Used when promoting from inbox or renaming from tags.">
                <input className="field path" value={config.pathTemplate} onChange={e => set("pathTemplate")(e.target.value)} />
              </SettingRow>

              <div style={{ marginTop: 16, padding: 14, background: "var(--bg-2)", border: "1.5px solid var(--line)" }}>
                <div className="label">Live preview</div>
                <div className="path-text" style={{ color: "var(--ink-2)", marginTop: 6 }}>
                  {config.libraryPath}/<span style={{ color: "var(--green)" }}>{examplePath}</span>
                </div>
              </div>

              <div style={{ marginTop: 22 }}>
                <div className="label" style={{ marginBottom: 8 }}>Available placeholders</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {placeholders.map(p => (
                    <span key={p} onClick={() => set("pathTemplate")(config.pathTemplate + p)} style={{
                      fontFamily: "var(--f-mono)", fontSize: 12,
                      padding: "4px 10px", background: "var(--bg-2)",
                      border: "1.5px solid var(--line)", color: "var(--cyan)",
                      cursor: "pointer",
                    }}>{p}</span>
                  ))}
                </div>
              </div>

              <SettingRow label="Sanitize illegal characters" hint="Replace : / \\ ? * etc. with safe equivalents." style={{ marginTop: 22 }}>
                <Toggle on={config.sanitizeChars} onChange={set("sanitizeChars")} />
              </SettingRow>
              <SettingRow label="Lowercase extension" hint="e.g. .FLAC → .flac">
                <Toggle on={config.lowercaseExtension} onChange={set("lowercaseExtension")} />
              </SettingRow>
              <SettingRow label="Pad track number to 2 digits" hint="03 instead of 3">
                <Toggle on={config.padTrackNumber} onChange={set("padTrackNumber")} />
              </SettingRow>
            </div>
          )}

          {section === "mb" && (
            <div style={{ maxWidth: isMobile ? '100%' : 720 }}>

              {/* ── MusicBrainz ── */}
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 400, letterSpacing: "0.02em" }}>MUSICBRAINZ</h2>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Metadata database used for tag lookups and release enrichment.</div>
              </div>

              <SettingRow label="Server address" hint="Default: musicbrainz.org">
                <input className="field" value={config.musicbrainz.server} onChange={e => setMb("server")(e.target.value)} />
              </SettingRow>
              <SettingRow label="Port" hint="Default: 443 (HTTPS)">
                <input className="field" value={config.musicbrainz.port} onChange={e => setMb("port")(Number(e.target.value))} style={{ width: 120 }} />
              </SettingRow>

              <div style={{ marginTop: 18, marginBottom: 12 }}>
                <div className="label">Account (optional)</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Required for accessing your MusicBrainz collections.</div>
              </div>

              <SettingRow label="Username">
                <input className="field" value={config.musicbrainz.username} onChange={e => setMb("username")(e.target.value)} />
              </SettingRow>
              <SettingRow label="Password">
                <input type="password" className="field" value={config.musicbrainz.password} onChange={e => setMb("password")(e.target.value)} />
              </SettingRow>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="btn">Test connection</button>
                <button className="btn">Authorize OAuth…</button>
                {config.musicbrainz.username && (
                  <>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: "var(--green)", alignSelf: "center" }}>● connected as {config.musicbrainz.username}</span>
                  </>
                )}
              </div>

              {/* ── AcoustID ── */}
              <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px dashed var(--line)", marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 400, letterSpacing: "0.02em" }}>ACOUSTID</h2>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Audio fingerprinting service for identifying tracks by their sound. Fingerprinting uses a built-in app key — a personal key is only needed to submit fingerprints.</div>
              </div>

              <SettingRow
                label="User API key"
                hint={<>Optional — required to submit fingerprints. <a href="https://acoustid.org/api-key" target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>Register at acoustid.org</a></>}
              >
                <input className="field" value={config.musicbrainz.acoustidUserKey ?? ''} onChange={e => setMb("acoustidUserKey")(e.target.value)} placeholder="Leave blank if not submitting" />
              </SettingRow>
              <SettingRow
                label="Submit unmatched fingerprints"
                hint="When a track isn't found in AcoustID, automatically submit it to help grow the database. Requires a user API key."
                style={{ opacity: config.musicbrainz.acoustidUserKey ? 1 : 0.45 }}
              >
                <Toggle on={config.musicbrainz.submitFingerprints} onChange={setMb("submitFingerprints")} disabled={!config.musicbrainz.acoustidUserKey} />
              </SettingRow>

            </div>
          )}

          {section === "processing" && (
            <div style={{ maxWidth: isMobile ? '100%' : 720 }}>
              <div style={{ padding: "12px 14px", marginBottom: 18, background: "color-mix(in oklch, var(--yellow) 8%, transparent)", borderLeft: "3px solid var(--yellow)" }}>
                <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  Controls how Graffiti Tagger identifies and prepares files when moving them from the Inbox to the Library.
                </div>
              </div>

              <SettingRow label="Start processing on add" hint="Automatically run the pipeline when files are added to the Inbox. Acceptance is always threshold-based regardless of this setting.">
                <Toggle on={config.autoProcess} onChange={set("autoProcess")} />
              </SettingRow>

              <SettingRow label="ReplayGain standard" hint="R128 (EBU −23 LUFS) is current best practice. Legacy uses the older −89 dB reference used by older players.">
                <div style={{ display: "flex", gap: 8 }}>
                  {["r128", "legacy"].map(opt => (
                    <button
                      key={opt}
                      onClick={() => set("replaygainStandard")(opt)}
                      style={{
                        padding: "5px 16px", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                        background: config.replaygainStandard === opt ? "var(--green)" : "var(--bg-2)",
                        color: config.replaygainStandard === opt ? "oklch(0.15 0 0)" : "var(--ink-3)",
                        border: `1.5px solid ${config.replaygainStandard === opt ? "oklch(0.15 0 0)" : "var(--line)"}`,
                        cursor: "pointer",
                        boxShadow: config.replaygainStandard === opt ? "2px 2px 0 var(--pink)" : "none",
                      }}
                    >
                      {opt === "r128" ? "R128 (EBU)" : "Legacy"}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="AcoustID confidence threshold" hint="Matches above this are auto-applied. Below this threshold you'll be asked to confirm. Range: 0–1.">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={config.acoustidConfidenceThreshold}
                    onChange={e => set("acoustidConfidenceThreshold")(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "var(--cyan)" }}
                  />
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--cyan)", width: 36, textAlign: "right" }}>
                    {Math.round(config.acoustidConfidenceThreshold * 100)}%
                  </span>
                </div>
              </SettingRow>

              <SettingRow label="Fake lossless detection" hint="Use ffprobe spectral analysis to flag FLAC files that appear to have been transcoded from lossy sources (brickwall high-frequency cutoff).">
                <Toggle on={config.fakeLosslessDetection} onChange={set("fakeLosslessDetection")} />
              </SettingRow>
            </div>
          )}

          {section === "tags" && (
            <div style={{ maxWidth: isMobile ? '100%' : 820 }}>
              <div style={{ padding: "10px 14px", marginBottom: 20, background: "color-mix(in oklch, var(--yellow) 8%, transparent)", borderLeft: "3px solid var(--yellow)", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "var(--ink-2)", flex: 1 }}>
                  Define which tags are required for a healthy track. Ignored tags are excluded from health scoring and can be stripped from library files on demand.
                </span>
                {recomputingHealth && <span style={{ fontSize: 12, color: "var(--ink-3)", flexShrink: 0 }}>Recalculating health scores…</span>}
              </div>

              {/* Cover Art — synthetic entry, cannot be Ignored */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontFamily: "var(--f-display)", fontSize: 13, letterSpacing: "0.04em" }}>COVER ART</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Cover Art</span>
                    <span style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--ink-4)", marginLeft: 8 }}>cover_art</span>
                    <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 8 }}>embedded image</span>
                  </div>
                  <TagModeToggle
                    tagKey="cover_art"
                    value={config.tagSettings?.cover_art ?? 'mandatory'}
                    onChange={v => setTagSetting('cover_art', v)}
                  />
                </div>
              </div>

              {/* All tag groups */}
              {TAG_GROUPS.map(group => {
                const tags = TAGS_BY_GROUP[group.key] ?? []
                if (tags.length === 0) return null
                const hasShortcuts = ['replaygain', 'musicbrainz', 'acoustid'].includes(group.key)
                return (
                  <div key={group.key} style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontFamily: "var(--f-display)", fontSize: 13, letterSpacing: "0.04em" }}>{group.label.toUpperCase()}</span>
                      {hasShortcuts && (
                        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
                          <button className="btn ghost" onClick={() => setGroupTagSettings(group.key, 'optional')} style={{ padding: "1px 8px", fontSize: 10 }}>All Optional</button>
                          <button className="btn ghost" onClick={() => setGroupTagSettings(group.key, 'ignored')} style={{ padding: "1px 8px", fontSize: 10 }}>Ignore all</button>
                        </div>
                      )}
                    </div>
                    {tags.map(tag => (
                      <div key={tag.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--line-soft)" }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{tag.label}</span>
                          <span style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--ink-4)", marginLeft: 8 }}>{tag.key}</span>
                          {tag.readOnly && (
                            <span style={{ fontSize: 10, color: "var(--ink-4)", marginLeft: 8, border: "1px solid var(--line)", padding: "1px 5px" }}>read-only</span>
                          )}
                        </div>
                        <TagModeToggle
                          tagKey={tag.key}
                          value={config.tagSettings?.[tag.key] ?? (tag.readOnly ? 'ignored' : 'optional')}
                          onChange={v => setTagSetting(tag.key, v)}
                          readOnly={tag.readOnly}
                        />
                      </div>
                    ))}
                  </div>
                )
              })}

              {/* Remove ignored tags */}
              {(() => {
                const ts = config.tagSettings ?? {}
                const ignoredCount = Object.values(ts).filter(v => v === 'ignored').length
                if (ignoredCount === 0) return null
                return (
                  <div style={{ marginTop: 8, padding: "12px 16px", background: "color-mix(in oklch, var(--yellow) 6%, transparent)", border: "1.5px solid var(--line)", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--yellow)", fontSize: 14, flexShrink: 0 }}>⚠</span>
                    <span style={{ fontSize: 13, flex: 1 }}>
                      {ignoredCount} tag{ignoredCount !== 1 ? 's' : ''} set to Ignored
                    </span>
                    <button
                      className="btn"
                      onClick={async () => {
                        setRemoveIgnoredRunning(true)
                        setRemoveIgnoredResult(null)
                        try {
                          const r = await fetch('/api/library/remove-ignored-tags', { method: 'POST' })
                          const reader = r.body.getReader()
                          const dec = new TextDecoder()
                          let lastData = null
                          while (true) {
                            const { done, value } = await reader.read()
                            if (done) break
                            const text = dec.decode(value)
                            for (const line of text.split('\n')) {
                              if (line.startsWith('data:')) {
                                try { lastData = JSON.parse(line.slice(5).trim()) } catch {}
                              }
                            }
                          }
                          setRemoveIgnoredResult({ ok: true, total: lastData?.total ?? '?' })
                          window.dispatchEvent(new CustomEvent('gt:library-refresh'))
                        } catch (e) {
                          setRemoveIgnoredResult({ error: e.message })
                        } finally {
                          setRemoveIgnoredRunning(false)
                        }
                      }}
                      disabled={removeIgnoredRunning}
                      style={{ flexShrink: 0 }}
                    >
                      {removeIgnoredRunning ? "Removing…" : "Remove Ignored Tags from Library"}
                    </button>
                    {removeIgnoredResult && (
                      <span style={{ fontSize: 12, flexShrink: 0, color: removeIgnoredResult.error ? "var(--pink)" : "var(--green)" }}>
                        {removeIgnoredResult.error
                          ? `Error: ${removeIgnoredResult.error}`
                          : `Done — ${removeIgnoredResult.total} files processed`}
                      </span>
                    )}
                  </div>
                )
              })()}

              <div style={{ height: 40 }} />
            </div>
          )}

          {section === "tools" && (
            <div style={{ maxWidth: isMobile ? '100%' : 720 }}>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>Graffiti Tagger wraps these CLI tools. Configure the path if the binary isn't on your PATH.</div>
              <SettingRow label="Batch FLAC reads" hint="One metaflac call per album directory instead of one per file. Faster for large libraries; disable to diagnose tag-parsing issues.">
                <Toggle on={config.batchFlac} onChange={set("batchFlac")} />
              </SettingRow>
              <div style={{ marginTop: 20, marginBottom: 8 }} />
              {TOOLS.map(({ key, label, desc }) => {
                const status = toolStatus?.[key]
                const ok = status?.ok ?? null
                const ver = status?.version ?? null
                return (
                  <div key={key} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 90px 30px" : "150px 1fr 90px 30px", gap: 14, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{desc}</div>
                    </div>
                    <PathField value={config.bins[key]} onChange={setBinAndCheck(key)} mode="file" />
                    <div style={{ fontSize: 12, color: ok === null ? "var(--ink-4)" : ok ? "var(--green)" : "var(--ink-4)", fontFamily: "var(--f-mono)" }}>
                      {ok === null ? "…" : ok ? `v${ver}` : "missing"}
                    </div>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: ok === null ? "var(--bg-3)" : ok ? "var(--green)" : "var(--pink)", display: "block", margin: "0 auto" }} />
                  </div>
                )
              })}
            </div>
          )}

          {section === "appearance" && (
            <div style={{ maxWidth: isMobile ? '100%' : 600 }}>
              <SettingRow label="Use Tweaks panel" hint="Toggle the live tweaks panel from the toolbar.">
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Available via the Tweaks toggle in the toolbar.</span>
              </SettingRow>
            </div>
          )}

          <div style={{ height: 60 }} />
          </div>
        </div>
        )}
      </div>

      <StatusBar left={`Section: ${section}`} right={statusRight} />
    </div>
  )
}

export default SettingsView
