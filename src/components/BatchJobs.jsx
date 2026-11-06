import React from 'react'

export async function startBatch(paths, opts = {}) {
  const res = await fetch('/api/inbox/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, replaygain: true, promote: true, ...opts }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  window.dispatchEvent(new CustomEvent('gt:batch-started'))
  return data
}

const STAGE_LABEL = {
  queued: 'Queued',
  processing: 'Identifying & tagging',
  replaygain: 'Scanning ReplayGain',
  promoting: 'Promoting to library',
  done: 'Finished',
  error: 'Failed',
}

const isActive = j => j.stage !== 'done' && j.stage !== 'error'

// Server-side jobs keep running when the dialog/page is closed; this just reports progress.
const BatchJobs = ({ onFinished }) => {
  const [jobs, setJobs] = React.useState([])
  const seenActive = React.useRef(new Set())
  const onFinishedRef = React.useRef(onFinished)
  React.useEffect(() => { onFinishedRef.current = onFinished }, [onFinished])

  const poll = React.useCallback(async () => {
    try {
      const list = await fetch('/api/inbox/batch').then(r => r.json())
      if (!Array.isArray(list)) return
      setJobs(list)
      for (const j of list) {
        if (isActive(j)) seenActive.current.add(j.id)
        else if (seenActive.current.delete(j.id)) {
          window.dispatchEvent(new CustomEvent('gt:library-refresh'))
          onFinishedRef.current?.(j)
        }
      }
    } catch { /* ignore transient errors */ }
  }, [])

  React.useEffect(() => {
    poll()
    const t = setInterval(poll, 2000)
    const kick = () => poll()
    window.addEventListener('gt:batch-started', kick)
    return () => { clearInterval(t); window.removeEventListener('gt:batch-started', kick) }
  }, [poll])

  const dismiss = async id => {
    await fetch(`/api/inbox/batch/${id}`, { method: 'DELETE' }).catch(() => {})
    poll()
  }

  if (jobs.length === 0) return null

  return (
    <div style={{ background: 'var(--bg-0)', border: '1.5px solid var(--line)' }}>
      {jobs.map(j => {
        const active = isActive(j)
        const pct = j.total ? Math.round((j.processed / j.total) * 100) : 0
        const color = j.stage === 'error' ? 'var(--pink)' : active ? 'var(--cyan)' : 'var(--green)'
        return (
          <div key={j.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span className="sticker cyan" style={{ fontSize: 10 }}>BACKGROUND</span>
              <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>
                {STAGE_LABEL[j.stage]} · {j.total} file{j.total !== 1 ? 's' : ''}
              </span>
              {!active && (
                <button className="btn ghost" onClick={() => dismiss(j.id)} style={{ padding: '1px 7px', fontSize: 10 }}>✕</button>
              )}
            </div>
            <div style={{ height: 3, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', marginBottom: 5 }}>
              <div style={{ position: 'absolute', inset: 0, right: `${100 - (active ? pct : 100)}%`, background: color, transition: 'right 0.15s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--f-mono)' }}>
              {j.processed}/{j.total} processed · {j.replaygainDone} ReplayGain · {j.promoted} promoted
              {j.needsReview.length > 0 && <span style={{ color: 'var(--yellow)' }}> · {j.needsReview.length} need review (left in inbox)</span>}
              {j.failed.length > 0 && <span style={{ color: 'var(--pink)' }} title={j.failed.map(f => `${f.path}: ${f.error}`).join('\n')}> · {j.failed.length} failed</span>}
              {j.error && <span style={{ color: 'var(--pink)' }}> · {j.error}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default BatchJobs
