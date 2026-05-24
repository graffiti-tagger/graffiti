// Returns the numeric submission ID from AcoustID (viewable at acoustid.org/submission/{id}).
// The actual AcoustID UUID is assigned asynchronously — callers must do a follow-up
// fingerprint lookup after AcoustID has processed the submission.
export async function submitAcoustID(
  fingerprint: string,
  duration: number,
  appKey: string,
  userKey: string,
  recordingId?: string,
): Promise<number | null> {
  const body = new URLSearchParams({
    client:        appKey,
    user:          userKey,
    'duration.0':  Math.round(duration).toString(),
    'fingerprint.0': fingerprint,
  })
  if (recordingId) body.set('mbid.0', recordingId)

  const res = await fetch('https://api.acoustid.org/v2/submit', {
    method: 'POST',
    headers: {
      'User-Agent': 'GraffitiTagger/1.0',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AcoustID submit HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`)
  }
  try {
    const data = await res.json() as {
      status: string
      submissions?: Array<{ id: number; index: string; status: string }>
    }
    return data.submissions?.[0]?.id ?? null
  } catch {
    return null
  }
}

export interface AcoustIDSubmission {
  fingerprint: string
  duration: number
  recordingId?: string
  trackTitle?: string
  artist?: string
  album?: string
  albumArtist?: string
  year?: string
  trackNo?: number
  discNo?: number
  bitrate?: number
  fileFormat?: string
}

export interface SubmissionResult {
  index: number
  id: number
}

export async function batchSubmitAcoustID(
  submissions: AcoustIDSubmission[],
  appKey: string,
  userKey: string,
): Promise<SubmissionResult[]> {
  const body = new URLSearchParams({ client: appKey, user: userKey })
  for (let i = 0; i < submissions.length; i++) {
    const s = submissions[i]
    body.set(`fingerprint.${i}`, s.fingerprint)
    body.set(`duration.${i}`, Math.round(s.duration).toString())
    if (s.recordingId)  body.set(`mbid.${i}`,        s.recordingId)
    if (s.trackTitle)   body.set(`track.${i}`,        s.trackTitle)
    if (s.artist)       body.set(`artist.${i}`,       s.artist)
    if (s.album)        body.set(`album.${i}`,        s.album)
    if (s.albumArtist)  body.set(`albumartist.${i}`,  s.albumArtist)
    if (s.year)         body.set(`year.${i}`,         s.year)
    if (s.trackNo != null) body.set(`trackno.${i}`,  String(s.trackNo))
    if (s.discNo  != null) body.set(`discno.${i}`,   String(s.discNo))
    if (s.bitrate != null) body.set(`bitrate.${i}`,  String(s.bitrate))
    if (s.fileFormat)   body.set(`fileformat.${i}`,  s.fileFormat)
  }
  const res = await fetch('https://api.acoustid.org/v2/submit', {
    method: 'POST',
    headers: { 'User-Agent': 'GraffitiTagger/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AcoustID submit HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`)
  }
  const data = await res.json() as {
    status: string
    submissions?: Array<{ index: number; id: number; status: string }>
  }
  if (data.status !== 'ok') throw new Error(`AcoustID submit: ${data.status}`)
  return (data.submissions ?? []).map(s => ({ index: s.index, id: s.id }))
}

export interface SubmissionStatus {
  id: number
  status: 'pending' | 'imported' | 'error'
  acoustidId?: string
}

export async function getSubmissionStatus(
  submissionIds: number[],
  appKey: string,
): Promise<SubmissionStatus[]> {
  const params = new URLSearchParams({ client: appKey })
  for (const id of submissionIds) params.append('id', String(id))
  const res = await fetch(`https://api.acoustid.org/v2/submission_status?${params}`, {
    headers: { 'User-Agent': 'GraffitiTagger/1.0' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AcoustID submission_status HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`)
  }
  const data = await res.json() as {
    status: string
    submissions?: Array<{ id: number; status: string; result?: { id: string } }>
  }
  if (data.status !== 'ok') throw new Error(`AcoustID submission_status: ${data.status}`)
  return (data.submissions ?? []).map(s => ({
    id: s.id,
    status: s.status as SubmissionStatus['status'],
    acoustidId: s.result?.id,
  }))
}

// Look up AcoustIDs already linked to MusicBrainz recording IDs.
// Returns a map of recordingId → acoustid_id for any that already exist in AcoustID.
export async function listAcoustIDsByMbid(
  recordingIds: string[],
  appKey: string,
): Promise<Map<string, string>> {
  const params = new URLSearchParams({ client: appKey, batch: '1' })
  for (const mbid of recordingIds) params.append('mbid', mbid)
  const res = await fetch(`https://api.acoustid.org/v2/track/list_by_mbid?${params}`, {
    headers: { 'User-Agent': 'GraffitiTagger/1.0' },
  })
  if (!res.ok) return new Map()
  const data = await res.json() as {
    status: string
    tracks?: Record<string, Array<{ id: string; disabled?: boolean }>>
  }
  if (data.status !== 'ok' || !data.tracks) return new Map()
  const result = new Map<string, string>()
  for (const [mbid, tracks] of Object.entries(data.tracks)) {
    const first = tracks.find(t => !t.disabled)
    if (first) result.set(mbid, first.id)
  }
  return result
}

export interface AcoustIDMatch {
  acoustidId: string
  confidence: number
  recordingId: string | null
}

export async function lookupAcoustID(
  fingerprint: string,
  duration: number,
  apiKey: string,
  maxAttempts = 3
): Promise<AcoustIDMatch[]> {
  const params = new URLSearchParams({
    client: apiKey,
    fingerprint,
    duration: Math.round(duration).toString(),
    meta: 'recordingids',
  })

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`https://api.acoustid.org/v2/lookup?${params}`, {
        headers: { 'User-Agent': 'GraffitiTagger/1.0' },
      })

      const text = await res.text()
      let data: { status: string; error?: { code: number; message: string }; results?: Array<{ id: string; score: number; recordings?: Array<{ id: string }> }> }
      try {
        data = JSON.parse(text)
      } catch {
        // Upstream proxy returned non-JSON (e.g. "upstream connect error") — retry
        lastError = new Error(`AcoustID: unexpected response (${text.slice(0, 80)})`)
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }

      if (!res.ok || data.status !== 'ok') {
        const detail = data.error?.message ?? data.status ?? `HTTP ${res.status}`
        throw new Error(`AcoustID: ${detail}`)
      }

      return (data.results ?? [])
        .map(r => ({
          acoustidId: r.id,
          confidence: r.score,
          recordingId: r.recordings?.[0]?.id ?? null,
        }))
        .sort((a, b) => b.confidence - a.confidence)
    } catch (err) {
      if ((err as Error).message.startsWith('AcoustID:') && !(err as Error).message.includes('unexpected response')) {
        throw err // don't retry real API errors (bad key, etc.)
      }
      lastError = err as Error
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastError!
}
