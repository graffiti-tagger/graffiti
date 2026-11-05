import React from 'react'
import { useNavigate } from 'react-router-dom'
import ProcessPanel from './ProcessPanel.jsx'
import BatchJobs, { startBatch } from './BatchJobs.jsx'

// ─── shared helpers ──────────────────────────────────────────────────────────

async function* readSSEStream(res) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop()
    for (const part of parts) {
      const dataLine = part.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      try { yield JSON.parse(dataLine.slice(5).trim()) } catch { /* skip malformed */ }
    }
  }
}

const fmtBytes = b => {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

const AUDIO_EXTS = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff'])


// ─── IngestProgress ───────────────────────────────────────────────────────────

const IngestProgress = ({ job, onDismiss }) => {
  const { phase, downloaded, total, extractFile, extractN, extractOf, files, error, label, uploadPct, uploadTotal } = job
  const pct = (() => {
    if (phase === 'done') return 100
    if (phase === 'error') return 0
    if (phase === 'uploading') return uploadPct ?? null
    if (phase === 'downloading' && downloaded != null && total) return Math.round((downloaded / total) * 100)
    if (phase === 'extracting' && extractN != null && extractOf) return Math.round((extractN / extractOf) * 100)
    return null
  })()
  const color = phase === 'done' ? 'var(--green)' : phase === 'error' ? 'var(--pink)' : 'var(--cyan)'
  const statusText = (() => {
    if (phase === 'error') return error
    if (phase === 'done') return `Done — ${files?.length ?? 0} file${files?.length !== 1 ? 's' : ''} added`
    if (phase === 'uploading') {
      const size = uploadTotal ? ` · ${fmtBytes(uploadTotal)}` : ''
      return uploadPct != null ? `Uploading · ${uploadPct}%${size}` : 'Uploading…'
    }
    if (phase === 'downloading') {
      const size = total ? ` · ${fmtBytes(total)}` : ''
      return pct != null ? `Downloading · ${pct}%${size}` : total ? `Downloading · ${fmtBytes(downloaded)}` : 'Downloading…'
    }
    if (phase === 'extracting') return `Extracting · ${extractFile} (${extractN}/${extractOf})`
    return 'Connecting…'
  })()
  const isDone = phase === 'done' || phase === 'error'

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {isDone && <button className="btn ghost" onClick={onDismiss} style={{ padding: '1px 7px', fontSize: 10, color: 'var(--ink-4)', flex: '0 0 auto' }}>✕</button>}
      </div>
      <div style={{ height: 3, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', marginBottom: 4 }}>
        {pct !== null ? (
          <div style={{ position: 'absolute', inset: 0, right: `${100 - pct}%`, background: color, transition: 'right 0.15s ease' }} />
        ) : (
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: '45%', background: color, animation: 'indeterminate 1.2s linear infinite' }} />
        )}
      </div>
      <div style={{ fontSize: 11, color: phase === 'error' ? 'var(--pink)' : 'var(--ink-3)' }}>{statusText}</div>
    </div>
  )
}

// ─── UrlAdder ─────────────────────────────────────────────────────────────────

const UrlAdder = ({ onJobUpdate, onJobAdd }) => {
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    const trimmed = url.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const jobId = `url-${Date.now()}`
    onJobAdd({ id: jobId, label: trimmed.length > 60 ? '…' + trimmed.slice(-57) : trimmed, phase: 'connecting' })
    setUrl('')
    try {
      const res = await fetch('/api/inbox/add-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok || !res.body) { onJobUpdate(jobId, { phase: 'error', error: `HTTP ${res.status}` }); return }
      for await (const event of readSSEStream(res)) {
        if (event.phase === 'downloading') onJobUpdate(jobId, { phase: 'downloading', downloaded: event.downloaded, total: event.total })
        else if (event.phase === 'extracting') onJobUpdate(jobId, { phase: 'extracting', extractFile: event.file, extractN: event.n, extractOf: event.of })
        else if (event.phase === 'done') onJobUpdate(jobId, { phase: 'done', files: event.files })
        else if (event.phase === 'error') onJobUpdate(jobId, { phase: 'error', error: event.message })
      }
    } catch (e) { onJobUpdate(jobId, { phase: 'error', error: e.message }) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Paste a direct link to an audio file or a .zip archive. Bandcamp, direct CDN links, and mirrors are supported.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="field"
          style={{ flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}
          placeholder="https://example.com/album.zip  or  track.flac"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          disabled={busy}
        />
        <button className="btn primary" onClick={submit} disabled={!url.trim() || busy} style={{ flex: '0 0 auto' }}>
          {busy ? '…' : '↓ Add'}
        </button>
      </div>
    </div>
  )
}

// ─── FileDropZone ─────────────────────────────────────────────────────────────

const ACCEPTED = '.flac,.mp3,.ogg,.m4a,.aac,.wav,.aiff,.zip'
const ACCEPTED_EXTS_SET = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff', '.zip'])

const FileDropZone = ({ onJobUpdate, onJobAdd }) => {
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef(null)

  const upload = async files => {
    if (!files.length) return
    const jobId = `upload-${Date.now()}`
    const label = files.length === 1 ? files[0].name : `${files.length} files`
    onJobAdd({ id: jobId, label, phase: 'uploading', uploadPct: 0 })
    await new Promise((resolve, reject) => {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) onJobUpdate(jobId, { uploadPct: Math.round((e.loaded / e.total) * 100), uploadTotal: e.total })
      }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText)
          if (data.errors?.length) onJobUpdate(jobId, { phase: 'error', error: data.errors.join('; ') })
          else onJobUpdate(jobId, { phase: 'done', files: data.files })
        } catch { onJobUpdate(jobId, { phase: 'error', error: 'Unexpected server response' }) }
        resolve()
      }
      xhr.onerror = () => { onJobUpdate(jobId, { phase: 'error', error: 'Upload failed' }); reject() }
      xhr.open('POST', '/api/inbox/upload')
      xhr.send(fd)
    })
  }

  const handleDrop = e => {
    e.preventDefault(); setDragging(false)
    const files = [...e.dataTransfer.files].filter(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase()
      return ACCEPTED_EXTS_SET.has(ext)
    })
    if (files.length) upload(files)
  }

  const handleFileInput = e => {
    const files = [...e.target.files]
    if (files.length) upload(files)
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Drag and drop audio files or a .zip archive here, or click to open the file picker.
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          flex: 1,
          border: `1.5px dashed ${dragging ? 'var(--cyan)' : 'var(--line)'}`,
          background: dragging ? 'color-mix(in oklch, var(--cyan) 6%, transparent)' : 'var(--bg-2)',
          cursor: 'pointer', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'border-color 0.1s, background 0.1s',
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.4 }}>↑</div>
        <div style={{ fontSize: 13, color: dragging ? 'var(--cyan)' : 'var(--ink-3)' }}>
          {dragging ? 'Drop to upload' : 'Drop files here or click to browse'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>
          .flac .mp3 .ogg .m4a .wav .aiff .zip
        </div>
        <input ref={inputRef} type="file" multiple accept={ACCEPTED} style={{ display: 'none' }} onChange={handleFileInput} />
      </div>
    </div>
  )
}

// ─── ServerBrowser ────────────────────────────────────────────────────────────

const ServerBrowser = ({ onFilesSelected }) => {
  const [inboxPath, setInboxPath] = React.useState('')
  const [currentPath, setCurrentPath] = React.useState('')
  const [dirEntries, setDirEntries] = React.useState([])
  const [browserSelected, setBrowserSelected] = React.useState(new Set())
  const [loading, setLoading] = React.useState(false)
  const [breadcrumbs, setBreadcrumbs] = React.useState([])
  const rootRef = React.useRef('')

  const loadDir = React.useCallback(async (dirPath) => {
    setLoading(true)
    try {
      const data = await fetch(`/api/fs/ls?path=${encodeURIComponent(dirPath)}`).then(r => r.json())
      const filtered = (data.entries ?? []).filter(e =>
        e.isDir || AUDIO_EXTS.has('.' + (e.name.split('.').pop() || '').toLowerCase())
      )
      setDirEntries(filtered)
      setCurrentPath(dirPath)
      const root = rootRef.current
      const rel = dirPath.startsWith(root) ? dirPath.slice(root.length).replace(/^\/+/, '') : ''
      const parts = rel ? rel.split('/') : []
      setBreadcrumbs([
        { label: 'Inbox', path: root },
        ...parts.map((p, i) => ({ label: p, path: root + '/' + parts.slice(0, i + 1).join('/') })),
      ])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  React.useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(cfg => {
      const p = cfg.inboxPath || ''
      setInboxPath(p)
      rootRef.current = p
      loadDir(p)
    }).catch(() => {})
  }, [loadDir])

  // Recursive helpers use the inbox tree from /api/inbox (already walks subfolders)
  const addRecursive = async (folderPath) => {
    setLoading(true)
    try {
      const data = await fetch('/api/inbox').then(r => r.json())
      const files = []
      const collect = (nodes, inside) => {
        for (const n of nodes) {
          if (n.type === 'dir') collect(n.children ?? [], inside || n.path === folderPath)
          else if (inside) files.push(n.path)
        }
      }
      collect(data.entries ?? [], folderPath === data.inboxPath)
      if (files.length) onFilesSelected(files)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  const toggle = (path) => setBrowserSelected(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })

  const selCount = browserSelected.size

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Browse the server inbox folder. Select files, or use “Add all” on any folder to import everything beneath it in one click.
      </div>

      {/* Breadcrumbs */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', minHeight: 20 }}>
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={crumb.path}>
            {i > 0 && <span style={{ color: 'var(--ink-4)', fontSize: 11 }}>/</span>}
            <span
              onClick={() => loadDir(crumb.path)}
              style={{
                fontSize: 11, fontFamily: 'var(--f-mono)',
                color: i === breadcrumbs.length - 1 ? 'var(--ink-2)' : 'var(--cyan)',
                cursor: i === breadcrumbs.length - 1 ? 'default' : 'pointer',
              }}
            >{crumb.label}</span>
          </React.Fragment>
        ))}
        {loading && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>…</span>}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--line)', minHeight: 0 }}>
        {!loading && dirEntries.length === 0 && (
          <div style={{ padding: 16, color: 'var(--ink-4)', fontSize: 12, textAlign: 'center' }}>
            {inboxPath ? 'No audio files found here' : 'Inbox folder not configured in Settings'}
          </div>
        )}
        {dirEntries.map(e => {
          const isAudio = !e.isDir && AUDIO_EXTS.has('.' + (e.name.split('.').pop() || '').toLowerCase())
          const isSel = browserSelected.has(e.path)
          return (
            <div
              key={e.path}
              onClick={() => e.isDir ? loadDir(e.path) : toggle(e.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                borderBottom: '1px solid var(--line-soft)',
                background: isSel ? 'color-mix(in oklch, var(--cyan) 12%, transparent)' : 'transparent',
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              {isAudio ? (
                <input type="checkbox" checked={isSel} onChange={() => {}}
                  onClick={ev => { ev.stopPropagation(); toggle(e.path) }}
                  style={{ accentColor: 'var(--cyan)', flex: '0 0 auto', pointerEvents: 'none' }} />
              ) : (
                <span style={{ width: 14, flex: '0 0 auto', fontSize: 10, color: 'var(--ink-4)' }}>▶</span>
              )}
              <span style={{
                fontSize: e.isDir ? 13 : 12, fontWeight: e.isDir ? 600 : 400,
                color: e.isDir ? 'var(--ink-2)' : 'var(--ink-3)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: 'var(--f-mono)',
              }}>{e.name}</span>
              {e.isDir && (
                <button
                  className="btn ghost sm"
                  title="Add every audio file in this folder and its subfolders, and start processing"
                  onClick={ev => { ev.stopPropagation(); addRecursive(e.path) }}
                  style={{ padding: '1px 8px', fontSize: 10, flex: '0 0 auto' }}
                >⇒ Add all</button>
              )}
            </div>
          )
        })}
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn sm"
          onClick={() => loadDir(currentPath)}
          style={{ flex: '0 0 auto' }}
        >↻ Refresh</button>
        <button
          className="btn sm"
          onClick={() => addRecursive(currentPath)}
          disabled={!currentPath || loading}
          title="Add every audio file under the current folder, including subfolders"
          style={{ flex: '0 0 auto' }}
        >⇒ Add all in this folder (recursive)</button>
        <button
          className="btn primary sm"
          onClick={() => onFilesSelected([...browserSelected])}
          disabled={selCount === 0}
          style={{ flex: 1 }}
        >
          {selCount > 0 ? `⇒ Select ${selCount} file${selCount !== 1 ? 's' : ''}` : '⇒ Select files'}
        </button>
      </div>
    </div>
  )
}

// ─── AddMusicDialog ───────────────────────────────────────────────────────────

const SOURCE_TABS = ['download', 'upload', 'server']
const SOURCE_LABELS = { download: '↓ URL', upload: '↑ Upload', server: '⇒ Server' }

const AddMusicDialog = ({ onClose }) => {
  const navigate = useNavigate()

  // Inbox state
  const [entries, setEntries] = React.useState([])
  const [selected, setSelected] = React.useState(new Set())
  const [autoStart, setAutoStart] = React.useState(true)
  const [autoStartTrigger, setAutoStartTrigger] = React.useState(0)
  const [background, setBackground] = React.useState(false)
  const [batchError, setBatchError] = React.useState(null)

  // Dialog phase: true = show add form, false = show process panel
  const [showAddPanel, setShowAddPanel] = React.useState(true)
  const [activeSource, setActiveSource] = React.useState('download')
  const [jobs, setJobs] = React.useState([])

  React.useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(cfg => {
      setAutoStart(cfg.autoProcess ?? true)
    }).catch(() => {})
  }, [])

  const loadInbox = React.useCallback(async () => {
    try {
      const data = await fetch('/api/inbox').then(r => r.json())
      setEntries(data.entries ?? [])
    } catch (e) { console.error('Failed to load inbox:', e) }
  }, [])

  React.useEffect(() => { loadInbox() }, [loadInbox])

  // When inbox drains (everything promoted), go back to add panel
  React.useEffect(() => {
    if (entries.length === 0 && selected.size === 0) setShowAddPanel(true)
  }, [entries.length, selected.size])

  const runInBackground = React.useCallback(async (paths) => {
    setBatchError(null)
    try { await startBatch(paths) } catch (e) { setBatchError(e.message) }
  }, [])

  const handleFilesAdded = React.useCallback(async (newFiles) => {
    await loadInbox()
    if (background && newFiles && newFiles.length > 0) { runInBackground(newFiles); return }
    if (newFiles && newFiles.length > 0) {
      setSelected(prev => new Set([...prev, ...newFiles]))
      setShowAddPanel(false)
      if (autoStart) setAutoStartTrigger(n => n + 1)
    }
  }, [loadInbox, autoStart, background, runInBackground])

  const handleServerImport = (paths) => {
    if (paths.length === 0) return
    if (background) { runInBackground(paths); return }
    setSelected(prev => new Set([...prev, ...paths]))
    setShowAddPanel(false)
    if (autoStart) setAutoStartTrigger(n => n + 1)
  }

  const handlePromoted = () => {
    window.dispatchEvent(new CustomEvent('gt:library-refresh'))
    onClose()
    navigate('/tree')
  }

  const addJob = job => setJobs(prev => [job, ...prev])
  const updateJob = (id, patch) => {
    setJobs(prev => prev.map(j => {
      if (j.id !== id) return j
      const next = { ...j, ...patch }
      if (patch.phase === 'done') handleFilesAdded(patch.files ?? [])
      return next
    }))
  }
  const dismissJob = id => setJobs(prev => prev.filter(j => j.id !== id))

  const activeJob = jobs.find(j => j.phase !== 'done' && j.phase !== 'error')
  const errorJobs = jobs.filter(j => j.phase === 'error')

  const tabStyle = active => ({
    padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
    background: active ? 'var(--bg-3)' : 'transparent',
    border: `1.5px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
    color: active ? 'var(--ink)' : 'var(--ink-3)',
    cursor: 'pointer',
    boxShadow: active ? '2px 2px 0 var(--pink)' : 'none',
    flex: 1, textAlign: 'center', whiteSpace: 'nowrap',
  })

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'oklch(0 0 0 / 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(96vw, 1200px)', height: 'min(96dvh, 820px)',
          background: 'var(--bg-1)', border: '2px solid var(--line)',
          boxShadow: '4px 4px 0 var(--pink)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Dialog header */}
        <div style={{ padding: '0 12px', height: 48, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1.5px solid var(--line)', flex: '0 0 auto', background: 'var(--bg-2)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 14, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>ADD MUSIC</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ padding: '3px 10px', fontSize: 11, flexShrink: 0 }}>✕</button>
        </div>

        {/* ── Phase 1: Add panel ── */}
        {showAddPanel && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '12px 16px', gap: 12, overflow: 'auto' }}>
            {activeJob ? (
              /* Downloading/extracting — replace source UI with progress */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 20px', gap: 8 }}>
                <IngestProgress job={activeJob} onDismiss={null} />
              </div>
            ) : (
              <>
                {/* Source tabs */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {SOURCE_TABS.map(tab => (
                    <button key={tab} style={tabStyle(activeSource === tab)} onClick={() => setActiveSource(tab)}>
                      {SOURCE_LABELS[tab]}
                    </button>
                  ))}
                </div>

                {/* Source content */}
                <div style={{
                  flex: 1, minHeight: 0,
                  background: 'var(--bg-0)', border: '1.5px solid var(--line)',
                  padding: '12px 14px',
                  display: 'flex', flexDirection: 'column',
                }}>
                  {activeSource === 'download' && (
                    <UrlAdder onJobAdd={addJob} onJobUpdate={updateJob} />
                  )}
                  {activeSource === 'upload' && (
                    <FileDropZone onJobAdd={addJob} onJobUpdate={updateJob} />
                  )}
                  {activeSource === 'server' && (
                    <ServerBrowser onFilesSelected={handleServerImport} />
                  )}
                </div>

                {/* Error jobs */}
                {errorJobs.length > 0 && (
                  <div style={{ background: 'var(--bg-0)', border: '1.5px solid var(--line)', padding: '4px 14px' }}>
                    {errorJobs.map(job => (
                      <IngestProgress key={job.id} job={job} onDismiss={() => dismissJob(job.id)} />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Auto-process checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={e => setAutoStart(e.target.checked)}
                  style={{ accentColor: 'var(--cyan)' }}
                />
                Auto-process after adding
              </label>
              <label
                title="Identify, tag, scan ReplayGain and promote to the library on the server. Keeps running if you close this dialog; tracks needing review stay in the inbox."
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                <input
                  type="checkbox"
                  checked={background}
                  onChange={e => setBackground(e.target.checked)}
                  style={{ accentColor: 'var(--cyan)' }}
                />
                Run in background (ReplayGain + promote automatically)
              </label>
            </div>
            {batchError && <div style={{ fontSize: 11, color: 'var(--pink)' }}>{batchError}</div>}
            <BatchJobs onFinished={loadInbox} />
          </div>
        )}

        {/* ── Phase 2: Processing panel ── */}
        {!showAddPanel && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-0)' }}>
            <ProcessPanel
              selected={selected}
              autoStartTrigger={autoStart ? autoStartTrigger : 0}
              autoStart={autoStart}
              onPromoted={handlePromoted}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default AddMusicDialog
