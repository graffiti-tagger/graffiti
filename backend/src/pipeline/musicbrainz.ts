export interface MBRelease {
  id: string
  title: string
  date: string
  status: string
  trackNumber: string
  trackCount: number
  discNumber: string
  discCount: number
  totalTracks: number
  labelName: string | null
  labelCatalogNo: string | null
  country: string | null
  format: string | null
  disambiguation: string | null
  releaseGroupId: string
  releaseTrackId: string
}

export interface MBRecording {
  id: string
  title: string
  artist: string
  artistId: string
  durationMs: number | null
  releases: MBRelease[]
}

export interface MBReleaseCandidate {
  id: string
  title: string
  artist: string
  date: string
  country: string | null
  format: string | null
  totalTracks: number
  status: string
  score: number
  disambiguation: string | null
}

export async function lookupReleasesText(
  artist: string,
  album: string,
  creds?: { username: string; password: string },
  limit = 10
): Promise<MBReleaseCandidate[]> {
  const headers: Record<string, string> = {
    'User-Agent': 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )',
    Accept: 'application/json',
  }
  if (creds?.username && creds?.password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
  }
  const parts = [
    artist ? `artist:"${artist.replace(/"/g, '')}"` : '',
    album  ? `release:"${album.replace(/"/g, '')}"` : '',
  ].filter(Boolean).join(' AND ')
  if (!parts) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await fetch(
    `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(parts)}&fmt=json&limit=${limit}&inc=artist-credits+media`,
    { headers }
  )
  if (!res.ok) throw new Error(`MusicBrainz search HTTP ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.releases ?? []).map((rel: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const media: any[] = rel.media ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ac: any[] = rel['artist-credit'] ?? []
    return {
      id:             rel.id as string,
      title:          (rel.title ?? '') as string,
      artist:         ac.map(x => typeof x === 'string' ? x : x.artist?.name ?? '').join(''),
      date:           (rel.date ?? '') as string,
      country:        (rel.country ?? null) as string | null,
      status:         (rel.status ?? '') as string,
      format:         ([...new Set(media.map(m => m.format).filter(Boolean))] as string[]).join('+') || null,
      totalTracks:    media.reduce((s: number, m: any) => s + (m['track-count'] ?? 0), 0),
      score:          (rel.score ?? 0) as number,
      disambiguation: (rel.disambiguation || null) as string | null,
    }
  })
}

export async function lookupRecording(
  recordingId: string,
  credentials?: { username: string; password: string }
): Promise<MBRecording> {
  const url =
    `https://musicbrainz.org/ws/2/recording/${recordingId}` +
    `?inc=artists+releases+artist-credits+isrcs+media+release-groups&fmt=json`

  const headers: Record<string, string> = {
    'User-Agent': 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )',
    Accept: 'application/json',
  }

  if (credentials?.username && credentials?.password) {
    headers['Authorization'] =
      'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
  }

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const hint = body ? `: ${body.slice(0, 120)}` : ''
    throw new Error(`MusicBrainz HTTP ${res.status}${hint}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any

  const artistCredit: Array<{ artist?: { id: string; name: string } } | string> =
    data['artist-credit'] ?? []

  const artist = artistCredit
    .map(ac => (typeof ac === 'string' ? ac : ac.artist?.name ?? ''))
    .join('')
  const artistId = (artistCredit.find(ac => typeof ac !== 'string') as { artist?: { id: string } } | undefined)
    ?.artist?.id ?? ''

  const releases: MBRelease[] = (data.releases ?? []).map((rel: any) => {
    const media: any[] = rel.media ?? []
    let trackNumber = ''
    let trackCount = 0
    let discNumber = '1'
    let releaseTrackId = ''
    const discCount = media.length

    // For a recording lookup, each medium only includes the one track that
    // matches the recording — no need to search, just take tracks[0].
    for (let di = 0; di < media.length; di++) {
      const disc = media[di]
      const track = disc.tracks?.[0]
      if (track) {
        trackNumber = track.number ?? String(track.position ?? '')
        trackCount = disc['track-count'] ?? 0
        discNumber = String(di + 1)
        releaseTrackId = track.id ?? ''
        break
      }
    }

    const totalTracks = media.reduce((sum: number, m: any) => sum + (m['track-count'] ?? 0), 0)

    const formats = [...new Set(media.map((m: any) => m.format).filter(Boolean))] as string[]
    const format = formats.length > 0 ? formats.join('+') : null

    return {
      id: rel.id,
      title: rel.title ?? '',
      date: rel.date ?? '',
      status: rel.status ?? '',
      trackNumber,
      trackCount,
      discNumber,
      discCount,
      totalTracks,
      labelName: (rel['label-info'] as any[] | undefined)?.find((li: any) => li.label?.name)?.label?.name ?? null,
      labelCatalogNo: (rel['label-info'] as any[] | undefined)?.find((li: any) => li['catalog-number'])?.['catalog-number'] ?? null,
      country: rel.country ?? null,
      format,
      disambiguation: rel.disambiguation || null,
      releaseGroupId: rel['release-group']?.id ?? '',
      releaseTrackId,
    }
  })

  return {
    id: data.id,
    title: data.title ?? '',
    artist,
    artistId,
    durationMs: data.length ?? null,
    releases,
  }
}
