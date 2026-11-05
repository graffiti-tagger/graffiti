// Fetches front cover art from the Cover Art Archive (https://coverartarchive.org)
const CAA_BASE = 'https://coverartarchive.org'
const UA = 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )'
const MAX_BYTES = 20 * 1024 * 1024
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface FetchedCover {
  data: Buffer
  mimeType: string
  source: 'release' | 'release-group'
}

async function fetchFront(kind: 'release' | 'release-group', id: string, size: string): Promise<FetchedCover | null> {
  const res = await fetch(`${CAA_BASE}/${kind}/${id}/front${size}`, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Cover Art Archive returned ${res.status}`)
  const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim().toLowerCase()
  if (!mimeType.startsWith('image/')) return null
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length === 0 || data.length > MAX_BYTES) return null
  return { data, mimeType, source: kind }
}

// Tries the specific release first, then falls back to its release group.
// size: '' (original), '-500', '-250' or '-1200'
export async function fetchCoverArt(
  ids: { releaseId?: string | null; releaseGroupId?: string | null },
  size: '' | '-250' | '-500' | '-1200' = '-1200'
): Promise<FetchedCover | null> {
  if (ids.releaseId && ID_RE.test(ids.releaseId)) {
    const hit = await fetchFront('release', ids.releaseId, size)
    if (hit) return hit
  }
  if (ids.releaseGroupId && ID_RE.test(ids.releaseGroupId)) {
    return fetchFront('release-group', ids.releaseGroupId, size)
  }
  return null
}
