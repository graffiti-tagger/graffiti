import path from 'path'
import { checkIntegrity } from './integrity.js'
import { getAudioInfo, checkFakeLossless } from './audio-info.js'
import { lookupAcoustID, type AcoustIDMatch } from './acoustid.js'
import { ACOUSTID_APP_KEY } from '../constants.js'
import { lookupRecording, lookupReleasesText, type MBRecording, type MBReleaseCandidate } from './musicbrainz.js'
import { generateFingerprint } from '../fingerprint.js'
import { extractAllFlacArt, extractAllMp3Art, addEmbeddedArt } from '../art.js'
import { fetchCoverArt } from './coverart.js'
import { driverFor } from '../drivers/index.js'
import { getDb, getAllTracks } from '../db.js'
import type { Config } from '../config.js'

export type StepStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error'
export type FilePhase = 'running' | 'needs-review' | 'done' | 'error'

export type ProcessEvent =
  | { path: string; step: string; status: StepStatus; message?: string }
  | { path: string; phase: FilePhase; error?: string; result?: FileResult }

export interface FileResult {
  acoustidMatches: AcoustIDMatch[]
  bestMatch: MBRecording | null
  confidence: number
  tagIssues: string[]
  artPresent: boolean
  isDuplicate: boolean
  duplicatePath: string | null
  existingTags: Record<string, string>
  mbSearchCandidates: MBReleaseCandidate[]
}

const REQUIRED_TAGS = ['title', 'artist', 'album', 'albumartist', 'tracknumber', 'date']

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

// Returns an acquire function. Each call waits until at least minGapMs has
// passed since the previous call, serialising external API requests across all
// concurrent workers without a sleep on every individual track.
export function makeRateLimiter(minGapMs: number): () => Promise<void> {
  let gate: Promise<void> = Promise.resolve()
  return () => {
    const slot = gate
    gate = slot.then(() => sleep(minGapMs))
    return slot
  }
}

export const CONCURRENCY = 5

export async function hasEmbeddedArt(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  try {
    if (ext === 'flac') return (await extractAllFlacArt(filePath)).length > 0
    if (ext === 'mp3') return (await extractAllMp3Art(filePath)).length > 0
    // OGG/M4A/WAV: skip art check for now
    return true
  } catch {
    return false
  }
}

export async function processFiles(
  filePaths: string[],
  config: Config,
  emit: (event: ProcessEvent) => void
): Promise<void> {
  const db = getDb()
  const libraryTracks = getAllTracks(db)

  // Determine which pipeline steps to skip based on tag settings
  const ts = config.tagSettings ?? {}
  const skipAcoustid = ['acoustid_id', 'acoustid_fingerprint']
    .every(k => (ts[k] ?? 'optional') === 'ignored')
  const skipMusicbrainz = ['mb_recordingid', 'mb_releaseid', 'mb_artistid', 'mb_releasegroupid', 'mb_trackid']
    .every(k => (ts[k] ?? 'optional') === 'ignored')

  const acquireAcoustID = makeRateLimiter(400)
  const acquireMB = makeRateLimiter(config.musicbrainz.username ? 250 : 1100)

  async function processOne(filePath: string): Promise<void> {
    const result: FileResult = {
      acoustidMatches: [],
      bestMatch: null,
      confidence: 0,
      tagIssues: [],
      artPresent: false,
      isDuplicate: false,
      duplicatePath: null,
      existingTags: {},
      mbSearchCandidates: [],
    }

    try {
      emit({ path: filePath, phase: 'running' })

      // ── 1. Integrity ────────────────────────────────────────────────
      emit({ path: filePath, step: 'integrity', status: 'running' })
      const integrity = await checkIntegrity(filePath, {
        ffprobe: config.bins.ffprobe,
        ffmpeg: config.bins.ffmpeg,
      })
      emit({ path: filePath, step: 'integrity', status: integrity.ok ? 'ok' : 'error', message: integrity.message })
      if (!integrity.ok) {
        emit({ path: filePath, phase: 'error' })
        return
      }

      // ── 2. Audio stream info ────────────────────────────────────────
      emit({ path: filePath, step: 'audio', status: 'running' })
      try {
        const { info, flags } = await getAudioInfo(filePath, config.bins.ffprobe)

        if (config.fakeLosslessDetection) {
          const fake = await checkFakeLossless(filePath, config.bins.ffmpeg)
          if (fake.suspicious) flags.push({ id: 'fake_lossless', message: fake.message! })
        }

        const ext = path.extname(filePath).slice(1).toUpperCase()
        const summary = `${ext} · ${(info.sampleRate / 1000).toFixed(1)} kHz`
          + (info.bitDepth ? ` · ${info.bitDepth}-bit` : '')
          + (info.bitrate && !['FLAC', 'WAV', 'AIFF'].includes(ext)
            ? ` · ${Math.round(info.bitrate / 1000)} kbps` : '')

        emit({
          path: filePath, step: 'audio',
          status: flags.length > 0 ? 'warn' : 'ok',
          message: flags.length > 0 ? flags.map(f => f.message).join('; ') : summary,
        })
      } catch (e: unknown) {
        emit({ path: filePath, step: 'audio', status: 'warn', message: (e as Error).message })
      }

      // ── 3. Fingerprint ──────────────────────────────────────────────
      let fingerprint: string | null = null
      let duration: number | null = null
      if (skipAcoustid) {
        emit({ path: filePath, step: 'fingerprint', status: 'ok', message: 'Skipped — AcoustID tags ignored' })
      } else {
        emit({ path: filePath, step: 'fingerprint', status: 'running' })
        try {
          const fp = await generateFingerprint(filePath, config.bins.fpcalc)
          fingerprint = fp.fingerprint
          duration = fp.duration
          emit({ path: filePath, step: 'fingerprint', status: 'ok' })
        } catch (e: unknown) {
          emit({ path: filePath, step: 'fingerprint', status: 'warn', message: (e as Error).message })
        }
      }

      // ── 4. AcoustID ─────────────────────────────────────────────────
      let bestRecordingId: string | null = null

      if (skipAcoustid) {
        emit({ path: filePath, step: 'acoustid', status: 'ok', message: 'Skipped — AcoustID tags ignored' })
      } else if (fingerprint && duration) {
        emit({ path: filePath, step: 'acoustid', status: 'running' })
        try {
          const matches = await lookupAcoustID(fingerprint, duration, ACOUSTID_APP_KEY)
          result.acoustidMatches = matches

          if (matches.length === 0) {
            emit({ path: filePath, step: 'acoustid', status: 'warn', message: 'No match found' })
          } else {
            const best = matches[0]
            bestRecordingId = best.recordingId
            result.confidence = best.confidence
            const pct = Math.round(best.confidence * 100)
            emit({
              path: filePath, step: 'acoustid',
              status: best.confidence >= 0.5 ? 'ok' : 'warn',
              message: `${pct}% confidence`,
            })
          }
        } catch (e: unknown) {
          emit({ path: filePath, step: 'acoustid', status: 'warn', message: (e as Error).message })
        }
        await acquireAcoustID()
      } else {
        emit({ path: filePath, step: 'acoustid', status: 'warn', message: 'Skipped — no fingerprint' })
      }

      // ── 5. Duplicate check ──────────────────────────────────────────
      emit({ path: filePath, step: 'duplicate', status: 'running' })
      const dupTrack = libraryTracks.find(t => {
        if (bestRecordingId) {
          try {
            const tags = JSON.parse(t.tags_json ?? '{}')
            if (tags.musicbrainz_recordingid === bestRecordingId) return true
          } catch { /* ignore */ }
        }
        return false
      })
      if (dupTrack) {
        result.isDuplicate = true
        result.duplicatePath = dupTrack.path
        emit({ path: filePath, step: 'duplicate', status: 'warn', message: `Already in library: ${path.basename(dupTrack.path)}` })
      } else {
        emit({ path: filePath, step: 'duplicate', status: 'ok' })
      }

      // ── 6. MusicBrainz ──────────────────────────────────────────────
      if (skipMusicbrainz) {
        emit({ path: filePath, step: 'musicbrainz', status: 'ok', message: 'Skipped — MusicBrainz tags ignored' })
      } else if (bestRecordingId) {
        emit({ path: filePath, step: 'musicbrainz', status: 'running' })
        try {
          const creds = config.musicbrainz.username
            ? { username: config.musicbrainz.username, password: config.musicbrainz.password }
            : undefined

          const recording = await lookupRecording(bestRecordingId, creds)
          result.bestMatch = recording

          const rel = recording.releases[0]
          const year = rel?.date?.slice(0, 4)
          const summary = year
            ? `${recording.artist} - ${recording.title} (${year})`
            : `${recording.artist} - ${recording.title}`
          emit({ path: filePath, step: 'musicbrainz', status: 'ok', message: summary })
        } catch (e: unknown) {
          emit({ path: filePath, step: 'musicbrainz', status: 'warn', message: (e as Error).message })
        }
        await acquireMB()
      } else {
        // No AcoustID match — text-search using embedded tags so the review
        // dialog has candidates ready without a second round-trip from the frontend.
        emit({ path: filePath, step: 'musicbrainz', status: 'running' })
        try {
          const creds = config.musicbrainz.username
            ? { username: config.musicbrainz.username, password: config.musicbrainz.password }
            : undefined
          const driver = driverFor(filePath)
          const rawTags = await driver.readTags(filePath)
          const n = (v: unknown) => String(Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim()
          const searchArtist = n(rawTags['albumartist']) || n(rawTags['artist'])
          const searchAlbum  = n(rawTags['album'])
          if (searchArtist || searchAlbum) {
            result.mbSearchCandidates = await lookupReleasesText(searchArtist, searchAlbum, creds)
            const count = result.mbSearchCandidates.length
            emit({
              path: filePath, step: 'musicbrainz',
              status: count > 0 ? 'ok' : 'warn',
              message: count > 0 ? `${count} candidate${count !== 1 ? 's' : ''}` : 'No candidates found',
            })
          } else {
            emit({ path: filePath, step: 'musicbrainz', status: 'warn', message: 'No embedded tags to search' })
          }
        } catch (e: unknown) {
          emit({ path: filePath, step: 'musicbrainz', status: 'warn', message: (e as Error).message })
        }
        await acquireMB()
      }

      // ── 6b. Write identifier tags for confident matches ─────────────
      // Without this, files that skip manual review never get MB/AcoustID tags.
      if (result.bestMatch && result.confidence >= config.acoustidConfidenceThreshold && !result.isDuplicate) {
        try {
          const rel = result.bestMatch.releases[0]
          const ident: Record<string, string> = {
            musicbrainz_recordingid: result.bestMatch.id,
          }
          const acoustidId = result.acoustidMatches[0]?.acoustidId
          if (acoustidId) ident.acoustid_id = acoustidId
          if (result.bestMatch.artistId) ident.musicbrainz_artistid = result.bestMatch.artistId
          if (rel?.id) ident.musicbrainz_releaseid = rel.id
          if (rel?.releaseGroupId) ident.musicbrainz_releasegroupid = rel.releaseGroupId
          if (rel?.releaseTrackId) ident.musicbrainz_releasetrackid = rel.releaseTrackId
          const driver = driverFor(filePath)
          const existing = await driver.readTags(filePath).catch(() => ({}) as Record<string, string>)
          const main: Record<string, string> = {}
          const setMain = (k: string, v: string | undefined | null) => { if (v) main[k] = v }
          setMain('title', result.bestMatch.title)
          setMain('artist', result.bestMatch.artist)
          setMain('albumartist', rel?.albumArtist || result.bestMatch.artist)
          setMain('album', rel?.title)
          setMain('date', rel?.date?.slice(0, 4))
          setMain('tracknumber', rel?.trackNumber)
          if (rel?.trackCount) main.tracktotal = String(rel.trackCount)
          if (rel?.discCount && rel.discCount > 1) { main.discnumber = rel.discNumber; main.disctotal = String(rel.discCount) }
          if (!String((existing as Record<string, unknown>).genre ?? '').trim() && result.bestMatch.genres.length) {
            main.genre = result.bestMatch.genres.join('; ')
          }
          await driver.writeTags(filePath, { ...existing as Record<string, string>, ...main, ...ident })
        } catch (e: unknown) {
          emit({ path: filePath, step: 'musicbrainz', status: 'warn', message: `Could not write MB tags: ${(e as Error).message}` })
        }
      }

      // ── 7. Tag quality ──────────────────────────────────────────────
      emit({ path: filePath, step: 'tags', status: 'running' })
      try {
        const driver = driverFor(filePath)
        const tags = await driver.readTags(filePath)
        const norm = (v: unknown): string => {
          if (v == null) return ''
          return String(Array.isArray(v) ? v[0] : v).trim()
        }
        result.existingTags = Object.fromEntries(
          ['title', 'artist', 'albumartist', 'album', 'date', 'tracknumber', 'discnumber']
            .map(k => [k, norm(tags[k])])
        )
        const missing = REQUIRED_TAGS.filter(k => !String(tags[k] ?? '').trim())
        result.tagIssues = missing
        emit({
          path: filePath, step: 'tags',
          status: missing.length === 0 ? 'ok' : 'warn',
          message: missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined,
        })
      } catch (e: unknown) {
        emit({ path: filePath, step: 'tags', status: 'warn', message: (e as Error).message })
      }

      // ── 8. Cover art ────────────────────────────────────────────────
      emit({ path: filePath, step: 'art', status: 'running' })
      try {
        let hasArt = await hasEmbeddedArt(filePath)
        if (!hasArt && result.bestMatch) {
          const rel = result.bestMatch.releases[0]
          try {
            const cover = await fetchCoverArt({ releaseId: rel?.id, releaseGroupId: rel?.releaseGroupId })
            if (cover) {
              await addEmbeddedArt(filePath, cover.data, cover.mimeType, 3, config.bins)
              hasArt = true
            }
          } catch { /* cover art is best-effort */ }
        }
        result.artPresent = hasArt
        emit({
          path: filePath, step: 'art',
          status: hasArt ? 'ok' : 'warn',
          message: hasArt ? undefined : 'No embedded cover art',
        })
      } catch (e: unknown) {
        emit({ path: filePath, step: 'art', status: 'warn', message: (e as Error).message })
      }

      // ── Determine final phase ───────────────────────────────────────
      const needsReview =
        result.isDuplicate ||
        result.confidence < config.acoustidConfidenceThreshold

      emit({ path: filePath, phase: needsReview ? 'needs-review' : 'done', result })

    } catch (e: unknown) {
      emit({ path: filePath, phase: 'error', error: (e as Error).message })
    }
  }

  let idx = 0
  async function worker(): Promise<void> {
    while (idx < filePaths.length) {
      await processOne(filePaths[idx++])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, worker)
  )
}
