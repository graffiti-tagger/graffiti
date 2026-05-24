import React from 'react'

// ─── helpers ────────────────────────────────────────────────────────────────

const fmtBytes = b => {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

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

// ─── IngestProgress ─────────────────────────────────────────────────────────

const IngestProgress = ({ job, onDismiss }) => {
  const { phase, downloaded, total, extractFile, extractN, extractOf, files, error, label } = job

  const pct = (() => {
    if (phase === 'done') return 100
    if (phase === 'error') return 0
    if (phase === 'downloading' && downloaded != null && total) return Math.round((downloaded / total) * 100)
    if (phase === 'extracting' && extractN != null && extractOf) return Math.round((extractN / extractOf) * 100)
    return null // indeterminate
  })()

  const color = phase === 'done' ? 'var(--green)' : phase === 'error' ? 'var(--pink)' : 'var(--cyan)'

  const statusText = (() => {
    if (phase === 'error') return error
    if (phase === 'done') return `Done — ${files?.length ?? 0} file${files?.length !== 1 ? 's' : ''} added to inbox`
    if (phase === 'downloading') {
      const dl = fmtBytes(downloaded)
      return total ? `Downloading · ${dl} / ${fmtBytes(total)}` : `Downloading · ${dl}`
    }
    if (phase === 'extracting') return `Extracting · ${extractFile} (${extractN}/${extractOf})`
    return 'Connecting…'
  })()

  const isDone = phase === 'done' || phase === 'error'

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {isDone && (
          <button
            className="btn ghost"
            onClick={onDismiss}
            style={{ padding: '1px 7px', fontSize: 10, color: 'var(--ink-4)', flex: '0 0 auto' }}
          >✕</button>
        )}
      </div>

      {/* Bar */}
      <div style={{ height: 3, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', marginBottom: 5 }}>
        {pct !== null ? (
          <div style={{
            position: 'absolute', inset: 0, right: `${100 - pct}%`,
            background: color,
            transition: 'right 0.15s ease',
          }} />
        ) : (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '45%',
            background: color,
            animation: 'indeterminate 1.2s linear infinite',
          }} />
        )}
      </div>

      <div style={{ fontSize: 11, color: phase === 'error' ? 'var(--pink)' : 'var(--ink-3)' }}>
        {statusText}
      </div>
    </div>
  )
}

// ─── UrlAdder ───────────────────────────────────────────────────────────────

const UrlAdder = ({ onJobUpdate, onJobAdd }) => {
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    const trimmed = url.trim()
    if (!trimmed || busy) return
    setBusy(true)

    const jobId = `url-${Date.now()}`
    const label = trimmed.length > 60 ? '…' + trimmed.slice(-57) : trimmed
    onJobAdd({ id: jobId, label, phase: 'connecting' })
    setUrl('')

    try {
      const res = await fetch('/api/inbox/add-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok || !res.body) {
        onJobUpdate(jobId, { phase: 'error', error: `HTTP ${res.status}` })
        return
      }

      for await (const event of readSSEStream(res)) {
        if (event.phase === 'downloading') {
          onJobUpdate(jobId, { phase: 'downloading', downloaded: event.downloaded, total: event.total })
        } else if (event.phase === 'extracting') {
          onJobUpdate(jobId, { phase: 'extracting', extractFile: event.file, extractN: event.n, extractOf: event.of })
        } else if (event.phase === 'done') {
          onJobUpdate(jobId, { phase: 'done', files: event.files })
        } else if (event.phase === 'error') {
          onJobUpdate(jobId, { phase: 'error', error: event.message })
        }
      }
    } catch (e) {
      onJobUpdate(jobId, { phase: 'error', error: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
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
  )
}

// ─── FileDropZone ────────────────────────────────────────────────────────────

const ACCEPTED = '.flac,.mp3,.ogg,.m4a,.aac,.wav,.aiff,.zip'
const ACCEPTED_EXTS = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff', '.zip'])

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
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100)
          onJobUpdate(jobId, { uploadPct: pct })
        }
      }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText)
          if (data.errors?.length) {
            onJobUpdate(jobId, { phase: 'error', error: data.errors.join('; ') })
          } else {
            onJobUpdate(jobId, { phase: 'done', files: data.files })
          }
        } catch {
          onJobUpdate(jobId, { phase: 'error', error: 'Unexpected server response' })
        }
        resolve()
      }
      xhr.onerror = () => { onJobUpdate(jobId, { phase: 'error', error: 'Upload failed' }); reject() }
      xhr.open('POST', '/api/inbox/upload')
      xhr.send(fd)
    })
  }

  const handleDrop = e => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files].filter(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase()
      return ACCEPTED_EXTS.has(ext)
    })
    if (files.length) upload(files)
  }

  const handleFileInput = e => {
    const files = [...e.target.files]
    if (files.length) upload(files)
    e.target.value = ''
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `1.5px dashed ${dragging ? 'var(--cyan)' : 'var(--line)'}`,
        background: dragging ? 'color-mix(in oklch, var(--cyan) 6%, transparent)' : 'transparent',
        padding: '16px 20px',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'border-color 0.1s, background 0.1s',
      }}
    >
      <div style={{ fontSize: 13, color: dragging ? 'var(--cyan)' : 'var(--ink-3)', marginBottom: 4 }}>
        {dragging ? 'Drop to add to inbox' : 'Drop files here or click to browse'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>
        .flac .mp3 .ogg .m4a .wav .aiff .zip
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
    </div>
  )
}

// ─── AddToInbox (root) ───────────────────────────────────────────────────────

const AddToInbox = ({ onFilesAdded }) => {
  const [mode, setMode] = React.useState('url')
  const [jobs, setJobs] = React.useState([])

  const addJob = job => {
    setJobs(prev => [job, ...prev])
  }

  const updateJob = (id, patch) => {
    setJobs(prev => prev.map(j => {
      if (j.id !== id) return j
      const next = { ...j, ...patch }
      if (patch.phase === 'done' && onFilesAdded) onFilesAdded(patch.files ?? [])
      return next
    }))
  }

  const dismissJob = id => setJobs(prev => prev.filter(j => j.id !== id))

  // Separate uploading jobs from the upload pct tracker
  const uploadJobPct = job => {
    if (job.phase === 'uploading') return job.uploadPct ?? 0
    return null
  }

  // Build progress props per job
  const progressProps = job => {
    if (job.phase === 'uploading') {
      return { ...job, phase: 'downloading', downloaded: uploadJobPct(job), total: 100 }
    }
    return job
  }

  const tabStyle = active => ({
    padding: '4px 12px',
    fontSize: 11,
    letterSpacing: '0.06em',
    fontWeight: 700,
    background: active ? 'var(--bg-3)' : 'transparent',
    border: `1.5px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
    color: active ? 'var(--ink)' : 'var(--ink-3)',
    cursor: 'pointer',
    boxShadow: active ? '2px 2px 0 var(--pink)' : 'none',
    transition: 'none',
  })

  return (
    <div style={{ padding: '16px 20px', background: 'var(--bg-0)' }}>
      {/* Tabs + input row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: jobs.length ? 10 : 0 }}>
        <button style={tabStyle(mode === 'url')} onClick={() => setMode('url')}>↓ URL</button>
        <button style={tabStyle(mode === 'upload')} onClick={() => setMode('upload')}>↑ UPLOAD</button>
        <div style={{ flex: 1, marginLeft: 8 }}>
          {mode === 'url' ? (
            <UrlAdder onJobAdd={addJob} onJobUpdate={updateJob} />
          ) : (
            <FileDropZone onJobAdd={addJob} onJobUpdate={updateJob} />
          )}
        </div>
      </div>

      {/* Progress list */}
      {jobs.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {jobs.map(job => (
            <IngestProgress
              key={job.id}
              job={progressProps(job)}
              onDismiss={() => dismissJob(job.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default AddToInbox
