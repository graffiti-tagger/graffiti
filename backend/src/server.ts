import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  extractAllFlacArt, extractAllMp3Art,
  listFolderImages, findFolderCover, removeEmbeddedArt, addEmbeddedArt,
  pictureTypeLabel, type ArtImage,
} from './art.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { readConfig, writeConfig, Config } from './config.js'
import { initDrivers, driverFor } from './drivers/index.js'
import { CliTagDriver } from './drivers/CliTagDriver.js'
import { getDb, getAllTracks, getLibraryTree, trackToApiRow, removeTracksByPaths, getTagPrefs, upsertTagPrefs, deleteTagPrefs, insertPendingSubmissions, getPendingSubmissions, hasPathInQueue, resolveSubmissions, updateSubmissionsChecked, removeStaleSubmissions, getTrackByPath } from './db.js'
import { scanLibrary, rebuildLibrary, rescanFile } from './scanner.js'
import { generateFingerprint, generateFingerprintsBatch } from './fingerprint.js'
import { downloadUrlToInbox, saveUploadedFile, saveUploadedZip, type IngestEvent } from './inbox-ingest.js'
import { processFiles, hasEmbeddedArt, type ProcessEvent } from './pipeline/process.js'
import { runReplayGain } from './pipeline/replaygain.js'
import { promoteFiles } from './pipeline/promote.js'
import { startBatchJob, waitForBatchJob, snapshotJob, listBatchJobs, getBatchJob, dismissBatchJob } from './batch.js'
import { computeHealth } from './pipeline/health.js'
import { lookupAcoustID, submitAcoustID, batchSubmitAcoustID, getSubmissionStatus, listAcoustIDsByMbid } from './pipeline/acoustid.js'
import { ACOUSTID_APP_KEY } from './constants.js'
import { lookupRecording, lookupReleasesText } from './pipeline/musicbrainz.js'
import { fetchCoverArt } from './pipeline/coverart.js'
import { startInboxWatcher } from './watcher.js'
import { applyPuidPgid } from './privileges.js'
import multipart from '@fastify/multipart'

const PORT = Number(process.env.PORT ?? 3001)
const ART_BODY_LIMIT = 20 * 1024 * 1024 // 20 MB for base64-encoded image uploads

type RebuildResult = { added: number; skipped: number; durationMs: number } | { error: string }
let rebuildStatus: { running: boolean; result: RebuildResult | null } = { running: false, result: null }

async function start() {
  applyPuidPgid()
  const config = await readConfig()
  initDrivers(config.bins)

  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } })

  if (process.env.NODE_ENV === 'production') {
    const publicDir = path.join(__dirname, '..', 'public')
    await app.register(fastifyStatic, { root: publicDir, wildcard: false })
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api')) { reply.code(404); return { error: 'Not found' } }
      return reply.sendFile('index.html')
    })
  }

  // --- Tools status ---

  app.get('/api/tools/status', async () => {
    const config = await readConfig()
    const bins: Record<string, string> = {
      metaflac:      config.bins.metaflac,
      vorbiscomment: config.bins.vorbiscomment,
      AtomicParsley: config.bins.AtomicParsley,
      fpcalc:        config.bins.fpcalc,
      rsgain:        config.bins.rsgain,
      ffprobe:       config.bins.ffprobe,
      ffmpeg:        config.bins.ffmpeg,
    }
    const versionFlags: Record<string, string[]> = {
      metaflac:      ['--version'],
      vorbiscomment: ['--version'],
      AtomicParsley: ['--version'],
      fpcalc:        ['-version'],
      rsgain:        ['--version'],
      ffprobe:       ['-version'],
      ffmpeg:        ['-version'],
    }
    const results: Record<string, { ok: boolean; version: string | null }> = {}
    await Promise.all(
      Object.entries(bins).map(async ([key, bin]) => {
        try {
          const { stdout, stderr } = await import('child_process').then(({ execFile }) =>
            new Promise<{ stdout: string; stderr: string }>((resolve, reject) =>
              execFile(bin, versionFlags[key], (err, stdout, stderr) => {
                // Some tools exit non-zero for --version; treat any output as success
                if (err && !stdout && !stderr) reject(err)
                else resolve({ stdout, stderr })
              })
            )
          )
          const text = (stdout + stderr).trim()
          const match = text.match(/\d+\.\d+[\d.]*/)
          results[key] = { ok: true, version: match ? match[0] : null }
        } catch {
          results[key] = { ok: false, version: null }
        }
      })
    )
    return results
  })

  // --- Settings ---

  app.get('/api/settings', async () => readConfig())

  app.put<{ Body: Config }>('/api/settings', async (req, reply) => {
    await writeConfig(req.body)
    initDrivers(req.body.bins)
    reply.code(204).send()
  })

  // --- Filesystem browser ---

  app.get<{ Querystring: { path?: string; showHidden?: string } }>('/api/fs/ls', async (req, reply) => {
    const dirPath = req.query.path || config.libraryPath || '/'
    const showHidden = req.query.showHidden === 'true'
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const listed = entries
        .filter(e => showHidden || !e.name.startsWith('.'))
        .filter(e => e.isDirectory() || e.isFile())
        .map(e => ({
          name: e.name,
          path: path.join(dirPath, e.name),
          isDir: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      return {
        path: dirPath,
        parent: path.dirname(dirPath) !== dirPath ? path.dirname(dirPath) : null,
        entries: listed,
      }
    } catch (err: unknown) {
      reply.code(400)
      return { error: (err as Error).message }
    }
  })

  // --- Album art ---

  app.get<{ Querystring: { path: string; index?: string } }>('/api/art', async (req, reply) => {
    const { path: filePath, index: indexStr } = req.query
    if (!filePath) return reply.code(400).send({ error: 'path required' })

    const ext = path.extname(filePath).toLowerCase()
    const hasIndex = indexStr !== undefined
    const index = hasIndex ? parseInt(indexStr!) : -1

    let result: { data: Buffer; mimeType: string } | null = null

    if (ext === '.flac') {
      const all = await extractAllFlacArt(filePath)
      result = hasIndex ? (all[index] ?? null) : (all.find(a => a.pictureType === 3) ?? all[0] ?? null)
    } else if (ext === '.mp3') {
      const all = await extractAllMp3Art(filePath)
      result = hasIndex ? (all[index] ?? null) : (all.find(a => a.pictureType === 3) ?? all[0] ?? null)
    }

    if (!result) {
      const cover = await findFolderCover(path.dirname(filePath))
      if (cover) {
        const data = await fs.readFile(cover.filePath).catch(() => null)
        if (data) {
          reply.header('Content-Type', cover.mimeType)
          reply.header('Cache-Control', 'public, max-age=300')
          return reply.send(data)
        }
      }
    }

    if (!result) return reply.code(404).send()
    reply.header('Content-Type', result.mimeType)
    reply.header('Cache-Control', 'public, max-age=3600')
    return reply.send(result.data)
  })

  app.get<{ Querystring: { folder: string; sampleTrack?: string } }>('/api/art/list', async (req, reply) => {
    const { folder, sampleTrack } = req.query
    if (!folder) return reply.code(400).send({ error: 'folder required' })

    const embedded: Array<{
      index: number; mimeType: string; pictureType: number
      pictureTypeLabel: string; size: number; url: string
    }> = []

    if (sampleTrack) {
      const ext = path.extname(sampleTrack).toLowerCase()
      let images: ArtImage[] = []
      if (ext === '.flac') images = await extractAllFlacArt(sampleTrack)
      else if (ext === '.mp3') images = await extractAllMp3Art(sampleTrack)

      images.forEach((img, i) => {
        embedded.push({
          index: i,
          mimeType: img.mimeType,
          pictureType: img.pictureType,
          pictureTypeLabel: pictureTypeLabel(img.pictureType),
          size: img.data.length,
          url: `/api/art?path=${encodeURIComponent(sampleTrack)}&index=${i}`,
        })
      })
    }

    const folderFiles = await listFolderImages(folder)
    return {
      embedded,
      folderFiles: folderFiles.map(f => ({
        filePath: f.filePath,
        name: f.name,
        mimeType: f.mimeType,
        url: `/api/art/file?path=${encodeURIComponent(f.filePath)}`,
      })),
    }
  })

  app.post<{
    Body: { trackPaths: string[]; data?: string; fromFilePath?: string; mimeType: string; pictureType?: number }
  }>('/api/art/embed', { bodyLimit: ART_BODY_LIMIT }, async (req, reply) => {
    const { trackPaths, data, fromFilePath, mimeType, pictureType = 3 } = req.body
    if (!trackPaths?.length) return reply.code(400).send({ error: 'trackPaths required' })
    if (!data && !fromFilePath) return reply.code(400).send({ error: 'data or fromFilePath required' })

    const config = await readConfig()
    let imageData: Buffer
    if (fromFilePath) {
      imageData = await fs.readFile(fromFilePath)
    } else {
      const base64 = data!.replace(/^data:[^;]+;base64,/, '')
      imageData = Buffer.from(base64, 'base64')
    }

    const results = await Promise.allSettled(
      trackPaths.map(p => addEmbeddedArt(p, imageData, mimeType, pictureType, config.bins))
    )
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    if (failed.length > 0) {
      reply.code(500)
      return { error: `Failed for ${failed.length} track(s): ${failed[0].reason?.message ?? 'Unknown error'}` }
    }
    reply.code(204).send()
  })

  app.get<{ Querystring: { releaseId?: string; releaseGroupId?: string; size?: string } }>('/api/art/fetch', async (req, reply) => {
    const { releaseId, releaseGroupId, size } = req.query
    if (!releaseId && !releaseGroupId) return reply.code(400).send({ error: 'releaseId or releaseGroupId required' })
    const sz = size === 'original' ? '' : size === '500' ? '-500' : size === '250' ? '-250' : '-1200'
    try {
      const cover = await fetchCoverArt({ releaseId, releaseGroupId }, sz)
      if (!cover) return reply.code(404).send({ error: 'No cover art found' })
      reply.header('X-Cover-Source', cover.source)
      return reply.type(cover.mimeType).send(cover.data)
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message })
    }
  })

  app.delete<{ Body: { trackPaths: string[] } }>('/api/art/embed', async (req, reply) => {
    const { trackPaths } = req.body
    if (!trackPaths?.length) return reply.code(400).send({ error: 'trackPaths required' })
    const config = await readConfig()
    const results = await Promise.allSettled(
      trackPaths.map(p => removeEmbeddedArt(p, config.bins))
    )
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    if (failed.length > 0) {
      reply.code(500)
      return { error: `Failed for ${failed.length} track(s): ${failed[0].reason?.message ?? 'Unknown error'}` }
    }
    reply.code(204).send()
  })

  app.get<{ Querystring: { path: string } }>('/api/art/file', async (req, reply) => {
    const { path: filePath } = req.query
    if (!filePath) return reply.code(400).send({ error: 'path required' })
    try {
      const data = await fs.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif' : 'image/jpeg'
      reply.header('Content-Type', mime)
      reply.header('Cache-Control', 'no-cache')
      return reply.send(data)
    } catch {
      return reply.code(404).send()
    }
  })

  app.post<{
    Body: { folder: string; filename: string; data: string; mimeType: string }
  }>('/api/art/file', { bodyLimit: ART_BODY_LIMIT }, async (req, reply) => {
    const { folder, filename, data, mimeType: _mime } = req.body
    if (!folder || !filename || !data) return reply.code(400).send({ error: 'folder, filename, data required' })
    const safeName = path.basename(filename)
    if (!safeName) return reply.code(400).send({ error: 'invalid filename' })
    const base64 = data.replace(/^data:[^;]+;base64,/, '')
    const filePath = path.join(folder, safeName)
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'))
    reply.code(201).send({ filePath, name: safeName })
  })

  app.delete<{ Body: { filePath: string } }>('/api/art/file', async (req, reply) => {
    const { filePath } = req.body
    if (!filePath) return reply.code(400).send({ error: 'filePath required' })
    await fs.unlink(filePath)
    reply.code(204).send()
  })

  // --- Tags ---

  app.get<{ Querystring: { path: string } }>('/api/tags', async (req, reply) => {
    const { path: filePath } = req.query
    if (!filePath) return reply.code(400).send({ error: 'path required' })
    const driver = driverFor(filePath)
    const [tags, info] = await Promise.all([
      driver.readTags(filePath),
      driver.readFileInfo(filePath),
    ])
    return { path: filePath, driver: driver.name, info, tags }
  })

  app.put<{ Querystring: { path: string }; Body: Record<string, string | string[]> }>(
    '/api/tags',
    async (req, reply) => {
      const { path: filePath } = req.query
      if (!filePath) return reply.code(400).send({ error: 'path required' })
      const driver = driverFor(filePath)
      await driver.writeTags(filePath, req.body)
      await rescanFile(filePath, driver)
      reply.code(204).send()
    }
  )

  // --- Inbox ---

  app.get('/api/inbox', async (req, reply) => {
    const config = await readConfig()
    if (!config.inboxPath) return reply.code(400).send({ error: 'inboxPath not configured' })

    const AUDIO_EXTS = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff'])

    interface InboxEntry {
      name: string; path: string; type: 'file' | 'dir'; ext?: string; children?: InboxEntry[]
    }

    async function walk(dir: string): Promise<InboxEntry[]> {
      let entries: import('fs').Dirent[]
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }

      const result: InboxEntry[] = []
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const fullPath = path.join(dir, e.name)
        if (e.isDirectory()) {
          const children = await walk(fullPath)
          if (children.length) result.push({ name: e.name, path: fullPath, type: 'dir', children })
        } else {
          const ext = path.extname(e.name).toLowerCase()
          if (AUDIO_EXTS.has(ext))
            result.push({ name: e.name, path: fullPath, type: 'file', ext: ext.slice(1) })
        }
      }
      return result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }

    return { inboxPath: config.inboxPath, entries: await walk(config.inboxPath) }
  })

  app.post<{ Body: { paths: string[]; folderName: string } }>('/api/inbox/cluster', async (req, reply) => {
    const { paths: filePaths, folderName } = req.body
    if (!filePaths?.length || !folderName?.trim()) return reply.code(400).send({ error: 'paths and folderName required' })
    const config = await readConfig()
    const destDir = path.join(config.inboxPath, folderName.trim())
    await fs.mkdir(destDir, { recursive: true })
    const results = await Promise.allSettled(
      filePaths.map(p => fs.rename(p, path.join(destDir, path.basename(p))))
    )
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    if (failed.length) return reply.code(500).send({ error: `Failed to move ${failed.length} file(s): ${failed[0].reason?.message}` })
    reply.code(204).send()
  })

  // --- Inbox ingest ---

  app.post<{ Body: { url: string } }>('/api/inbox/add-url', async (req, reply) => {
    const { url } = req.body
    if (!url) { reply.code(400); return { error: 'url required' } }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (event: IngestEvent) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      const config = await readConfig()
      await downloadUrlToInbox(url, config.inboxPath, send)
    } catch (err: unknown) {
      send({ phase: 'error', message: (err as Error).message })
    } finally {
      if (!raw.writableEnded) raw.end()
    }
  })

  app.post('/api/inbox/upload', async (req, reply) => {
    const config = await readConfig()
    const files: string[] = []
    const errors: string[] = []

    for await (const part of req.parts()) {
      if (part.type !== 'file') continue
      const ext = path.extname(part.filename).toLowerCase()
      try {
        if (ext === '.zip') {
          const extracted = await saveUploadedZip(part.file, config.inboxPath, () => {})
          files.push(...extracted)
        } else {
          const saved = await saveUploadedFile(part.file, part.filename, config.inboxPath)
          if (saved) files.push(saved)
          else { await part.file.resume(); errors.push(`${part.filename}: unsupported type`) }
        }
      } catch (e: unknown) {
        errors.push(`${part.filename}: ${(e as Error).message}`)
      }
    }

    return { files, errors }
  })

  // --- Inbox tag application ---

  app.post<{ Body: { path: string; tags: Record<string, string> } }>('/api/inbox/apply-tags', async (req, reply) => {
    const { path: filePath, tags } = req.body
    if (!filePath || !tags) { reply.code(400); return { error: 'path and tags required' } }
    try {
      const driver = driverFor(filePath)
      // Read existing tags and merge — only overwrite keys that have a non-empty value
      // so we don't wipe genre, replaygain, comments, etc.
      const existing = await driver.readTags(filePath).catch(() => ({}))
      const merged: Record<string, string> = { ...existing as Record<string, string> }
      for (const [k, v] of Object.entries(tags)) {
        if (v !== '' && v !== null && v !== undefined) merged[k] = v
      }
      await driver.writeTags(filePath, merged)
      return { ok: true }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // --- Inbox processing pipeline ---

  app.post<{ Body: { paths: string[]; autoProcess?: boolean } }>('/api/inbox/process', async (req, reply) => {
    const { paths, autoProcess } = req.body
    if (!paths?.length) { reply.code(400); return { error: 'paths required' } }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (event: ProcessEvent) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      const config = await readConfig()
      // Per-session autoProcess override
      const effectiveConfig = autoProcess !== undefined ? { ...config, autoProcess } : config
      await processFiles(paths, effectiveConfig, send)
    } catch (err: unknown) {
      send({ path: '', phase: 'error', error: (err as Error).message })
    } finally {
      if (!raw.writableEnded) raw.end()
    }
  })

  // --- Inbox ReplayGain ---

  app.post<{ Body: { paths: string[] } }>('/api/library/replaygain', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }
    try {
      const config = await readConfig()
      // Group by directory so each album is scanned together for correct album gain
      const byDir = new Map<string, string[]>()
      for (const p of filePaths) {
        const dir = path.dirname(p)
        if (!byDir.has(dir)) byDir.set(dir, [])
        byDir.get(dir)!.push(p)
      }
      const driver = driverFor(filePaths[0])
      for (const groupPaths of byDir.values()) {
        await runReplayGain(groupPaths, config.bins.rsgain, config.replaygainStandard)
        await Promise.all(groupPaths.map(p => rescanFile(p, driver)))
      }
      return { ok: true }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // Identify library tracks: fingerprint → AcoustID → MusicBrainz → write tags → rescan
  // Identify library tracks: fingerprint → AcoustID lookup → write acoustid_id tag → rescan
  // Check which tag groups are fully present across a set of paths
  app.post<{ Body: { paths: string[] } }>('/api/library/tag-status', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) return { rg: false, acoustid: false, mb: false }
    const db = getDb()
    const placeholders = filePaths.map(() => '?').join(',')
    const rows = db.prepare(`SELECT path, tags_json FROM tracks WHERE path IN (${placeholders})`).all(...filePaths) as { path: string; tags_json: string }[]
    // Only consider paths that exist in the DB
    const found = new Map(rows.map(r => [r.path, JSON.parse(r.tags_json || '{}') as Record<string, unknown>]))
    const allHave = (key: string) => filePaths.every(p => {
      const tags = found.get(p)
      return tags && tags[key] != null && tags[key] !== ''
    })
    return {
      rg:      allHave('replaygain_track_gain'),
      acoustid: allHave('acoustid_id'),
      mb:      ['musicbrainz_recordingid', 'musicbrainz_releaseid', 'musicbrainz_artistid',
                'musicbrainz_releasegroupid', 'musicbrainz_releasetrackid'].every(k => allHave(k)),
    }
  })

  // Identify: fingerprint → AcoustID lookup → write acoustid_id tag → rescan
  app.post<{ Body: { paths: string[] } }>('/api/library/identify', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    try {
      const config = await readConfig()
      const userKey = config.musicbrainz?.acoustidUserKey ?? ''
      const canSubmit = !!(userKey && config.musicbrainz?.submitFingerprints)
      const matchedPaths: string[] = []
      const submittedPaths: string[] = []
      const unmatchedPaths: string[] = []
      for (const filePath of filePaths) {
        const fp = await generateFingerprint(filePath, config.bins.fpcalc)
        const matches = await lookupAcoustID(fp.fingerprint, fp.duration, ACOUSTID_APP_KEY)
        if (matches.length) {
          const driver = driverFor(filePath)
          const existing = await driver.readTags(filePath).catch(() => ({}) as Record<string, string>)
          await driver.writeTags(filePath, { ...existing as Record<string, string>, acoustid_id: matches[0].acoustidId })
          await rescanFile(filePath, driver)
          matchedPaths.push(filePath)
        } else if (canSubmit) {
          await submitAcoustID(fp.fingerprint, fp.duration, ACOUSTID_APP_KEY, userKey).catch(e =>
            console.warn(`AcoustID submit failed for ${filePath}: ${e.message}`)
          )
          submittedPaths.push(filePath)
        } else {
          unmatchedPaths.push(filePath)
        }
        await sleep(400)
      }
      return {
        ok: true,
        matched:  matchedPaths.length,
        submitted: submittedPaths.length,
        unmatchedPaths,
        hasUserKey: !!userKey,
      }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // AcoustID submit: batch-fingerprint paths, submit to AcoustID, store submission IDs in the
  // DB queue, and return immediately. A background job checks the queue every 15 min and writes
  // acoustid_id tags once submissions are imported. First checks list_by_mbid to avoid
  // unnecessary submissions when fingerprints already exist in AcoustID from other users.
  app.post<{ Body: { paths: string[]; recordingIds?: Record<string, string> } }>('/api/library/acoustid-submit', async (req, reply) => {
    const { paths: filePaths, recordingIds } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }
    const db = getDb()

    try {
      const config = await readConfig()
      const userKey = config.musicbrainz?.acoustidUserKey ?? ''
      if (!userKey) { reply.code(400); return { error: 'No AcoustID user key configured in Settings' } }

      let acoustidTagsWritten = 0
      // Skip paths that already have a pending submission to avoid duplicate submissions
      const pendingPaths = new Set(filePaths.filter(p => !hasPathInQueue(db, p)))

      // Step 1: list_by_mbid — if AcoustID already has fingerprints for these recordings,
      // retrieve and write the acoustid_id immediately without submitting anything.
      const mbidPaths = [...pendingPaths].filter(p => recordingIds?.[p])
      if (mbidPaths.length > 0) {
        req.log.info({ count: mbidPaths.length }, 'acoustid-submit: checking list_by_mbid for existing acoustid_ids')
        const mbidToPath = new Map(mbidPaths.map(p => [recordingIds![p], p]))
        const existing = await listAcoustIDsByMbid([...mbidToPath.keys()], ACOUSTID_APP_KEY)
        for (const [mbid, acoustidId] of existing) {
          const filePath = mbidToPath.get(mbid)!
          try {
            const driver = driverFor(filePath)
            const tags = await driver.readTags(filePath).catch(() => ({}) as Record<string, string>)
            await driver.writeTags(filePath, { ...(tags as Record<string, string>), acoustid_id: acoustidId })
            await rescanFile(filePath, driver)
            acoustidTagsWritten++
            pendingPaths.delete(filePath)
            req.log.info({ file: path.basename(filePath), acoustidId }, 'acoustid-submit: existing acoustid_id written from list_by_mbid')
          } catch (err) {
            req.log.warn({ file: path.basename(filePath), err: (err as Error).message }, 'acoustid-submit: tag write failed')
          }
        }
        req.log.info({ found: existing.size, remaining: pendingPaths.size }, 'acoustid-submit: list_by_mbid done')
      }

      if (pendingPaths.size === 0) {
        req.log.info({ acoustidTagsWritten }, 'acoustid-submit: all resolved via list_by_mbid or already queued')
        return { ok: true, submitted: 0, acoustidTagsWritten }
      }

      // Step 2: generate fingerprints and batch-submit all remaining paths
      req.log.info({ count: pendingPaths.size }, 'acoustid-submit: generating fingerprints')
      const pathList = [...pendingPaths]

      const ph = pathList.map(() => '?').join(',')
      const dbRows = db.prepare(
        `SELECT path, tags_json FROM tracks WHERE path IN (${ph})`
      ).all(...pathList) as { path: string; tags_json: string }[]
      const tagsByPath = new Map(dbRows.map(r => [r.path, JSON.parse(r.tags_json || '{}') as Record<string, string>]))

      const batchInputs: Array<{ filePath: string; submission: import('./pipeline/acoustid.js').AcoustIDSubmission }> = []
      for (const filePath of pathList) {
        req.log.info({ file: path.basename(filePath) }, 'acoustid-submit: generating fingerprint')
        const fp = await generateFingerprint(filePath, config.bins.fpcalc)
        const tags = tagsByPath.get(filePath) ?? {}
        const normalise = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined
        batchInputs.push({
          filePath,
          submission: {
            fingerprint:  fp.fingerprint,
            duration:     fp.duration,
            recordingId:  recordingIds?.[filePath],
            trackTitle:   normalise(tags.title),
            artist:       normalise(tags.artist),
            album:        normalise(tags.album),
            albumArtist:  normalise(tags.albumartist),
            year:         normalise(tags.date)?.slice(0, 4),
            trackNo:      normalise(tags.tracknumber) ? parseInt(normalise(tags.tracknumber)!) : undefined,
            discNo:       normalise(tags.discnumber)  ? parseInt(normalise(tags.discnumber)!)  : undefined,
          },
        })
      }

      req.log.info({ count: batchInputs.length }, 'acoustid-submit: batch submitting')
      const results = await batchSubmitAcoustID(batchInputs.map(b => b.submission), ACOUSTID_APP_KEY, userKey)

      // Store submissions in the queue — background job will poll and write tags
      const queueItems = results
        .filter(r => batchInputs[r.index])
        .map(r => ({ submissionId: r.id, path: batchInputs[r.index].filePath }))
      insertPendingSubmissions(db, queueItems)

      const statusUrl = `https://api.acoustid.org/v2/submission_status?client=${ACOUSTID_APP_KEY}&${queueItems.map(s => `id=${s.submissionId}`).join('&')}`
      req.log.info({ count: queueItems.length, statusUrl }, 'acoustid-submit: queued, background job will write tags when imported')

      return { ok: true, submitted: queueItems.length, acoustidTagsWritten }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz lookup: fingerprint → AcoustID → MB → return candidate releases per path
  app.post<{ Body: { paths: string[] } }>('/api/library/musicbrainz/lookup', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    try {
      const config = await readConfig()
      const creds = config.musicbrainz?.username
        ? { username: config.musicbrainz.username, password: config.musicbrainz.password }
        : undefined

      type PerPath = {
        path: string
        acoustidId: string | null
        recordingId: string | null
        artistId: string | null
        recordingTitle: string | null
        recordingArtist: string | null
        releases: import('./pipeline/musicbrainz.js').MBRelease[]
        error?: string
      }

      const perPath: PerPath[] = []
      const releaseMap = new Map<string, import('./pipeline/musicbrainz.js').MBRelease & { matchCount: number }>()

      for (const filePath of filePaths) {
        try {
          const fp = await generateFingerprint(filePath, config.bins.fpcalc)
          const matches = await lookupAcoustID(fp.fingerprint, fp.duration, ACOUSTID_APP_KEY)
          await sleep(400)
          if (!matches.length || !matches[0].recordingId) {
            perPath.push({ path: filePath, acoustidId: matches[0]?.acoustidId ?? null, recordingId: null, artistId: null, recordingTitle: null, recordingArtist: null, releases: [] })
            continue
          }
          const recording = await lookupRecording(matches[0].recordingId, creds)
          await sleep(creds ? 250 : 1100)
          perPath.push({
            path: filePath,
            acoustidId: matches[0].acoustidId,
            recordingId: recording.id,
            artistId: recording.artistId,
            recordingTitle: recording.title,
            recordingArtist: recording.artist,
            releases: recording.releases,
          })
          for (const rel of recording.releases) {
            if (releaseMap.has(rel.id)) {
              releaseMap.get(rel.id)!.matchCount++
            } else {
              releaseMap.set(rel.id, { ...rel, matchCount: 1 })
            }
          }
        } catch (err) {
          perPath.push({ path: filePath, acoustidId: null, recordingId: null, artistId: null, recordingTitle: null, recordingArtist: null, releases: [], error: (err as Error).message })
        }
      }

      const releases = Array.from(releaseMap.values())
        .sort((a, b) => b.matchCount - a.matchCount || a.date.localeCompare(b.date))

      return { perPath, releases, totalPaths: filePaths.length }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz apply: write the user-chosen release ID to each path.
  // allPaths + releaseId are optional: when provided, any path not covered by
  // assignments is position-matched against the release tracklist as a fallback.
  app.post<{ Body: {
    assignments: Array<{ path: string; acoustidId: string; recordingId: string; artistId: string; releaseId: string; releaseGroupId: string; releaseTrackId: string }>
    allPaths?: string[]
    releaseId?: string
  } }>('/api/library/musicbrainz/apply', async (req, reply) => {
    const { assignments, allPaths, releaseId } = req.body
    if (!assignments?.length) { reply.code(400); return { error: 'assignments required' } }
    try {
      const config = await readConfig()
      const creds = config.musicbrainz?.username
        ? { username: config.musicbrainz.username, password: config.musicbrainz.password }
        : undefined
      const mbHeaders: Record<string, string> = {
        'User-Agent': 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )',
        Accept: 'application/json',
      }
      if (creds?.username && creds?.password) {
        mbHeaders['Authorization'] = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
      }

      // Always fetch the release when we have a releaseId — it's the single source
      // of truth for releaseGroupId and track IDs. Some recordings appear on many
      // releases so the per-recording lookup may not include this specific release,
      // leaving releaseGroupId/releaseTrackId empty in the assignment data.
      type ReleaseTrack = { recordingId: string; trackId: string }
      let releaseTracks: ReleaseTrack[] = []
      let releaseArtistId = ''
      let releaseGroupId = ''

      if (releaseId) {
        const res = await fetch(
          `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`,
          { headers: mbHeaders }
        )
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rel = await res.json() as any
          const ac = rel['artist-credit'] ?? []
          releaseArtistId = (ac.find((x: unknown) => typeof x !== 'string') as { artist?: { id: string } } | undefined)?.artist?.id ?? ''
          releaseGroupId = rel['release-group']?.id ?? ''
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          releaseTracks = (rel.media ?? []).flatMap((m: any) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (m.tracks ?? []).map((t: any) => ({ recordingId: t.recording?.id ?? '', trackId: t.id ?? '' }))
          )
        }
      }

      const matchedPaths = new Set(assignments.map(a => a.path))
      const unmatchedPaths = (allPaths ?? []).filter(p => !matchedPaths.has(p))

      // Build a map from recordingId → trackId using the release tracklist so matched
      // files can get their correct track ID even if the recording lookup missed it.
      const trackIdByRecording = new Map(releaseTracks.map(t => [t.recordingId, t.trackId]))

      // Write fingerprint-matched files
      for (const { path: filePath, acoustidId, recordingId, artistId, releaseId: rid } of assignments) {
        const pos = (allPaths ?? []).indexOf(filePath)
        // Prefer the track ID from the release tracklist matched by recording ID;
        // fall back to position when the AcoustID recording ID differs from the
        // release's recording (re-recordings, merged MBIDs, alternate pressings).
        const releaseTrackId = trackIdByRecording.get(recordingId) ?? releaseTracks[pos]?.trackId ?? ''
        const driver = driverFor(filePath)
        const existing = await driver.readTags(filePath).catch(() => ({}) as Record<string, string>)
        await driver.writeTags(filePath, {
          ...existing as Record<string, string>,
          acoustid_id:                acoustidId,
          musicbrainz_recordingid:    recordingId,
          musicbrainz_releaseid:      rid,
          musicbrainz_artistid:       artistId || releaseArtistId,
          musicbrainz_releasegroupid: releaseGroupId,
          musicbrainz_releasetrackid: releaseTrackId,
        })
        await rescanFile(filePath, driver)
      }

      // Write unmatched files using position in the full selection
      for (const filePath of unmatchedPaths) {
        const pos = (allPaths ?? []).indexOf(filePath)
        const track = releaseTracks[pos]
        if (!track || !releaseId) continue
        const driver = driverFor(filePath)
        const existing = await driver.readTags(filePath).catch(() => ({}) as Record<string, string>)
        await driver.writeTags(filePath, {
          ...existing as Record<string, string>,
          musicbrainz_recordingid:    track.recordingId,
          musicbrainz_releaseid:      releaseId,
          musicbrainz_artistid:       releaseArtistId,
          musicbrainz_releasegroupid: releaseGroupId,
          musicbrainz_releasetrackid: track.trackId,
        })
        await rescanFile(filePath, driver)
      }

      return { ok: true }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz text search: query by artist + album name
  app.post<{ Body: { artist?: string; album?: string } }>('/api/library/musicbrainz/search', async (req, reply) => {
    const { artist, album } = req.body
    if (!artist && !album) { reply.code(400); return { error: 'artist or album required' } }
    try {
      const config = await readConfig()
      const creds = config.musicbrainz?.username
        ? { username: config.musicbrainz.username, password: config.musicbrainz.password }
        : undefined
      const releases = await lookupReleasesText(artist ?? '', album ?? '', creds, 25)
      return { releases }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz release-tracklist: return artist + per-track data for a release (read-only, for the review dialog)
  app.post<{ Body: { releaseId: string } }>('/api/library/musicbrainz/release-tracklist', async (req, reply) => {
    const { releaseId } = req.body
    if (!releaseId) { reply.code(400); return { error: 'releaseId required' } }
    try {
      const config = await readConfig()
      const headers: Record<string, string> = {
        'User-Agent': 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )',
        Accept: 'application/json',
      }
      if (config.musicbrainz?.username && config.musicbrainz?.password) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${config.musicbrainz.username}:${config.musicbrainz.password}`).toString('base64')
      }
      const res = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`,
        { headers }
      )
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rel = await res.json() as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const joinAc = (ac: any[]): string =>
        (ac ?? []).map((x: unknown) => typeof x === 'string' ? x : (x as { artist?: { name: string } }).artist?.name ?? '').join('')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getAcId = (ac: any[]): string =>
        ((ac ?? []).find((x: unknown) => typeof x !== 'string') as { artist?: { id: string } } | undefined)?.artist?.id ?? ''
      const artistCredit = rel['artist-credit'] ?? []
      const discCount: number = (rel.media ?? []).length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracks = (rel.media ?? []).flatMap((m: any, di: number) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m.tracks ?? []).map((t: any) => ({
          recordingId: t.recording?.id ?? '',
          trackId:     t.id ?? '',
          title:       t.title || t.recording?.title || '',
          number:      t.number ?? String(t.position ?? ''),
          discNumber:  di + 1,
          discCount,
        }))
      )
      return {
        artist:         joinAc(artistCredit),
        artistId:       getAcId(artistCredit),
        releaseGroupId: rel['release-group']?.id ?? '',
        title:          rel.title ?? '',
        date:           rel.date ?? '',
        tracks,
      }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz apply-from-release: look up a release's tracklist and write per-track recording IDs
  app.post<{ Body: { paths: string[]; releaseId: string } }>('/api/library/musicbrainz/apply-from-release', async (req, reply) => {
    const { paths: filePaths, releaseId } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }
    if (!releaseId) { reply.code(400); return { error: 'releaseId required' } }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    try {
      const config = await readConfig()
      const creds = config.musicbrainz?.username
        ? { username: config.musicbrainz.username, password: config.musicbrainz.password }
        : undefined
      const headers: Record<string, string> = {
        'User-Agent': 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )',
        Accept: 'application/json',
      }
      if (creds?.username && creds?.password) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
      }
      const res = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`,
        { headers }
      )
      if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const release = await res.json() as any
      await sleep(creds ? 250 : 1100)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const artistCredit: any[] = release['artist-credit'] ?? []
      const artistId: string = (artistCredit.find(ac => typeof ac !== 'string') as { artist?: { id: string } } | undefined)?.artist?.id ?? ''
      const releaseGroupId: string = release['release-group']?.id ?? release['release-group-id'] ?? ''
      if (!releaseGroupId) console.warn(`apply-from-release: release ${releaseId} has no release-group id in API response`)

      // Flatten all tracks across all media in order, preserving track MBID and recording MBID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracks: Array<{ recordingId: string; trackId: string }> = (release.media ?? []).flatMap((m: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m.tracks ?? []).map((t: any) => ({
          recordingId: t.recording?.id ?? '',
          trackId:     t.id ?? '',
        }))
      )

      for (let i = 0; i < filePaths.length; i++) {
        const driver = driverFor(filePaths[i])
        const existing = await driver.readTags(filePaths[i]).catch(() => ({}) as Record<string, string>)
        await driver.writeTags(filePaths[i], {
          ...existing as Record<string, string>,
          musicbrainz_recordingid:    tracks[i]?.recordingId ?? '',
          musicbrainz_releaseid:      releaseId,
          musicbrainz_artistid:       artistId,
          musicbrainz_releasegroupid: releaseGroupId,
          musicbrainz_releasetrackid: tracks[i]?.trackId ?? '',
        })
        await rescanFile(filePaths[i], driver)
      }
      return { ok: true }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz enrich: fetch release metadata and build a per-track tag diff vs current DB tags
  app.post<{ Body: {
    paths: string[]
    releaseId: string
    assignments?: Array<{ path: string; acoustidId: string; recordingId: string; artistId: string }>
  } }>('/api/library/musicbrainz/enrich', async (req, reply) => {
    const { paths, releaseId, assignments } = req.body
    if (!paths?.length || !releaseId) { reply.code(400); return { error: 'paths and releaseId required' } }
    try {
      const config = await readConfig()
      const mbHeaders: Record<string, string> = {
        'User-Agent': 'GraffitiTagger/1.0 ( https://github.com/graffiti-tagger )',
        Accept: 'application/json',
      }
      if (config.musicbrainz?.username && config.musicbrainz?.password) {
        mbHeaders['Authorization'] = 'Basic ' + Buffer.from(`${config.musicbrainz.username}:${config.musicbrainz.password}`).toString('base64')
      }

      const relRes = await fetch(
        `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups+labels+media&fmt=json`,
        { headers: mbHeaders }
      )
      if (!relRes.ok) {
        const body = await relRes.text().catch(() => '')
        throw new Error(`MusicBrainz HTTP ${relRes.status}${body ? `: ${body.slice(0, 120)}` : ''}`)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rel = await relRes.json() as any

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const joinAc = (ac: any[]): string =>
        (ac ?? []).map((x: unknown) => typeof x === 'string' ? x : (x as { artist?: { name: string } }).artist?.name ?? '').join('')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getAcId = (ac: any[]): string =>
        ((ac ?? []).find((x: unknown) => typeof x !== 'string') as { artist?: { id: string } } | undefined)?.artist?.id ?? ''

      const releaseTitle: string  = rel.title ?? ''
      const releaseAc             = rel['artist-credit'] ?? []
      const releaseArtist: string = joinAc(releaseAc)
      const releaseArtistId       = getAcId(releaseAc)
      const releaseGroupId: string = rel['release-group']?.id ?? ''
      const releaseDate: string   = rel.date ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labelInfo: any[]      = rel['label-info'] ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstLabel            = labelInfo.find((li: any) => li.label?.name)
      const releaseLabel: string  = firstLabel?.label?.name ?? ''
      const releaseCatalogNo: string = firstLabel?.['catalog-number'] ?? ''

      type TrackInfo = {
        recordingId: string; trackId: string; title: string
        artist: string; artistId: string
        trackNumber: string; trackCount: number; discNumber: number; discCount: number
      }
      const discCount: number = (rel.media ?? []).length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allTracks: TrackInfo[] = (rel.media ?? []).flatMap((m: any, di: number) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m.tracks ?? []).map((t: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tAc: any[] = t['artist-credit'] ?? t.recording?.['artist-credit'] ?? []
          return {
            recordingId: t.recording?.id ?? '',
            trackId:     t.id ?? '',
            title:       t.title || t.recording?.title || '',
            artist:      joinAc(tAc) || releaseArtist,
            artistId:    getAcId(tAc) || releaseArtistId,
            trackNumber: t.number ?? String(t.position ?? ''),
            trackCount:  m['track-count'] ?? 0,
            discNumber:  di + 1,
            discCount,
          }
        })
      )

      const assignmentByPath = new Map((assignments ?? []).map(a => [a.path, a]))
      const trackByRecordingId = new Map(allTracks.map(t => [t.recordingId, t]))

      const db = getDb()
      const ph = paths.map(() => '?').join(',')
      const dbRows = db.prepare(
        `SELECT path, tags_json FROM tracks WHERE path IN (${ph})`
      ).all(...paths) as { path: string; tags_json: string }[]
      const tagsByPath = new Map(
        dbRows.map(r => [r.path, JSON.parse(r.tags_json || '{}') as Record<string, string | string[]>])
      )
      const prefsMap = getTagPrefs(db, paths)

      const TAG_LABELS: Record<string, string> = {
        title: 'Title', artist: 'Artist', albumartist: 'Album Artist',
        album: 'Album', tracknumber: 'Track #', tracktotal: 'Total Tracks',
        discnumber: 'Disc #', disctotal: 'Total Discs',
        date: 'Date', label: 'Label', catalognumber: 'Catalog #',
      }

      const normalise = (v: unknown): string => {
        if (v == null) return ''
        const s = Array.isArray(v) ? v[0] : v
        return String(s ?? '').trim()
      }

      const enriched = paths.map((filePath, pos) => {
        const assignment     = assignmentByPath.get(filePath)
        const assignedRecId  = assignment?.recordingId ?? ''
        const acoustidId     = assignment?.acoustidId  ?? ''
        const assignArtistId = assignment?.artistId    ?? ''

        const trackInfo: TrackInfo | undefined =
          (assignedRecId ? trackByRecordingId.get(assignedRecId) : undefined) ?? allTracks[pos]

        // Prefer the assignment's recording ID (from fingerprint match), fall back to
        // the position-matched track's ID (used when coming from manual MB search)
        const recordingId = assignedRecId || trackInfo?.recordingId || ''

        const currentTags = tagsByPath.get(filePath) ?? {}
        const pathPrefs   = prefsMap.get(filePath)  ?? new Set<string>()

        const proposed: Record<string, string> = {}
        if (trackInfo) {
          proposed.title       = trackInfo.title
          proposed.artist      = trackInfo.artist
          proposed.albumartist = releaseArtist
          proposed.album       = releaseTitle
          proposed.tracknumber = trackInfo.trackNumber
          proposed.tracktotal  = String(trackInfo.trackCount)
          proposed.discnumber  = String(trackInfo.discNumber)
          proposed.disctotal   = String(trackInfo.discCount)
          proposed.date        = releaseDate
          if (releaseLabel)     proposed.label         = releaseLabel
          if (releaseCatalogNo) proposed.catalognumber = releaseCatalogNo
        }

        const diffs = Object.entries(proposed)
          .filter(([key, proposedVal]) => {
            const cur = normalise(currentTags[key])
            const pro = proposedVal.trim()
            if (!pro) return false
            // Normalise tracknumber/discnumber for comparison (strip /total suffix)
            if (key === 'tracknumber' || key === 'discnumber') {
              return (cur.split('/')[0].trim() || '0') !== (pro.split('/')[0].trim() || '0')
            }
            return cur !== pro
          })
          .map(([key, proposedVal]) => ({
            key,
            label: TAG_LABELS[key] ?? key,
            current: normalise(currentTags[key]),
            proposed: proposedVal,
            preferLocal: pathPrefs.has(key),
          }))

        const artistId = trackInfo?.artistId || assignArtistId || releaseArtistId
        const identTags: Record<string, string> = {
          musicbrainz_releaseid:      releaseId,
          musicbrainz_artistid:       artistId,
          musicbrainz_releasegroupid: releaseGroupId,
          musicbrainz_releasetrackid: trackInfo?.trackId ?? '',
        }
        if (recordingId) identTags.musicbrainz_recordingid = recordingId
        if (acoustidId)  identTags.acoustid_id             = acoustidId

        return { path: filePath, filename: filePath.split('/').pop() ?? filePath, diffs, identTags }
      })

      return {
        releaseTitle,
        releaseArtist,
        releaseDate,
        releaseLabel,
        tracks:      enriched.map(({ path, filename, diffs }) => ({ path, filename, diffs })),
        identifiers: enriched.map(({ path, identTags: tags }) => ({ path, tags })),
      }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // MusicBrainz apply-tags: write approved metadata + identifier tags, persist tag preferences
  app.post<{ Body: {
    writes?: Array<{ path: string; tags: Record<string, string> }>
    prefsToSet?: Array<{ path: string; tagKey: string }>
    prefsToClear?: Array<{ path: string; tagKey: string }>
  } }>('/api/library/musicbrainz/apply-tags', async (req, reply) => {
    const { writes, prefsToSet, prefsToClear } = req.body
    try {
      for (const { path: filePath, tags } of writes ?? []) {
        const driver = driverFor(filePath)
        const existing = await driver.readTags(filePath).catch(() => ({}) as Record<string, string>)
        await driver.writeTags(filePath, { ...existing as Record<string, string>, ...tags })
        await rescanFile(filePath, driver)
      }
      const db = getDb()
      upsertTagPrefs(db, prefsToSet ?? [])
      deleteTagPrefs(db, prefsToClear ?? [])
      return { ok: true }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  app.post<{ Body: { paths: string[] } }>('/api/inbox/replaygain', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }
    try {
      const config = await readConfig()
      await runReplayGain(filePaths, config.bins.rsgain, config.replaygainStandard)
      return { ok: true }
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // --- Inbox promote to library ---

  app.post<{ Body: { paths: string[] } }>('/api/inbox/promote', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }

    const config = await readConfig()
    if (!config.libraryPath) { reply.code(400); return { error: 'libraryPath not configured' } }

    const { promoted, errors } = await promoteFiles(filePaths, config)
    if (errors.length > 0 && promoted.length === 0) {
      reply.code(500)
      return { error: errors[0].error, errors }
    }
    return { promoted, errors }
  })

  // --- Background batch jobs (process → ReplayGain → promote) ---

  app.post<{ Body: { paths: string[]; replaygain?: boolean; promote?: boolean } }>('/api/inbox/batch', async (req, reply) => {
    const { paths, replaygain = true, promote = true } = req.body
    if (!paths?.length) { reply.code(400); return { error: 'paths required' } }
    const config = await readConfig()
    if (promote && !config.libraryPath) { reply.code(400); return { error: 'libraryPath not configured' } }
    const job = startBatchJob(paths, config, { replaygain, promote })
    reply.code(202)
    return snapshotJob(job)
  })

  app.get('/api/inbox/batch', async () => listBatchJobs().map(snapshotJob))

  app.get<{ Params: { id: string } }>('/api/inbox/batch/:id', async (req, reply) => {
    const job = getBatchJob(req.params.id)
    if (!job) { reply.code(404); return { error: 'job not found' } }
    return snapshotJob(job)
  })

  app.delete<{ Params: { id: string } }>('/api/inbox/batch/:id', async (req, reply) => {
    if (!dismissBatchJob(req.params.id)) { reply.code(409); return { error: 'job not found or still running' } }
    reply.code(204).send()
  })

  // --- Fingerprints ---

  app.get<{ Querystring: { path: string } }>('/api/fingerprint', async (req, reply) => {
    const { path: filePath } = req.query
    if (!filePath) return reply.code(400).send({ error: 'path required' })
    const config = await readConfig()
    try {
      return await generateFingerprint(filePath, config.bins.fpcalc)
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  app.post<{ Body: { paths: string[] } }>('/api/fingerprint/batch', async (req, reply) => {
    const { paths } = req.body
    if (!paths?.length) return reply.code(400).send({ error: 'paths required' })
    const config = await readConfig()
    const resultMap = await generateFingerprintsBatch(paths, config.bins.fpcalc)
    const results: Record<string, { duration: number; fingerprint: string } | { error: string }> = {}
    for (const [p, r] of resultMap) {
      results[p] = r instanceof Error ? { error: r.message } : r
    }
    return results
  })

  // --- Library ---

  app.get('/api/library/rebuild/status', async () => rebuildStatus)

  app.post('/api/library/rebuild', async (req, reply) => {
    if (rebuildStatus.running) {
      reply.code(409)
      return { error: 'Rebuild already in progress' }
    }
    const config = await readConfig()
    if (!config.libraryPath) {
      reply.code(400)
      return { error: 'Library path not configured — check Settings > Folders' }
    }
    rebuildStatus = { running: true, result: null }
    reply.code(202).send({ running: true })
    const driver = new CliTagDriver(config.bins, { batchFlac: config.batchFlac })
    rebuildLibrary(config.libraryPath, driver)
      .then(result => { rebuildStatus = { running: false, result } })
      .catch(err => { rebuildStatus = { running: false, result: { error: (err as Error).message } } })
  })

  app.post('/api/library/scan', async (req, reply) => {
    const config = await readConfig()
    if (!config.libraryPath) {
      reply.code(400)
      return { error: 'Library path not configured — check Settings > Folders' }
    }
    try {
      const driver = new CliTagDriver(config.bins, { batchFlac: config.batchFlac })
      const result = await scanLibrary(config.libraryPath, driver)
      return result
    } catch (err: unknown) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  app.get('/api/library/tracks', async () => {
    const config = await readConfig()
    const db = getDb()
    const rows = getAllTracks(db)
    return { libraryPath: config.libraryPath, tracks: rows.map(trackToApiRow) }
  })

  app.get('/api/library/tree', async () => {
    const db = getDb()
    return getLibraryTree(db)
  })

  // --- Library Fix (run pipeline on existing library files, no promote) ---

  app.post<{ Body: { paths: string[] } }>('/api/library/fix', async (req, reply) => {
    const { paths } = req.body
    if (!paths?.length) { reply.code(400); return { error: 'paths required' } }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (event: ProcessEvent) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      const config = await readConfig()
      await processFiles(paths, config, send)

      // After pipeline, update has_cover_art and health_score in DB for each path
      const db = getDb()
      const ts = config.tagSettings ?? {}
      for (const filePath of paths) {
        try {
          const hasCoverArt = await hasEmbeddedArt(filePath)
          const driver = driverFor(filePath)
          const tags = await driver.readTags(filePath)
          const tagsJson = JSON.stringify(tags)
          db.prepare(
            'UPDATE tracks SET has_cover_art = ?, health_score = ? WHERE path = ?'
          ).run(hasCoverArt ? 1 : 0, computeHealth(tagsJson, hasCoverArt, ts), filePath)
        } catch { /* ignore individual file errors */ }
      }
    } catch (err: unknown) {
      send({ path: '', phase: 'error', error: (err as Error).message })
    } finally {
      if (!raw.writableEnded) raw.end()
    }
  })

  // Recompute health scores for all library tracks from stored tags_json + has_cover_art
  app.post('/api/library/recompute-health', async () => {
    const config = await readConfig()
    const ts = config.tagSettings ?? {}
    const db = getDb()
    const rows = getAllTracks(db)
    const stmt = db.prepare('UPDATE tracks SET health_score = ? WHERE path = ?')
    const update = db.transaction(() => {
      let updated = 0
      for (const row of rows) {
        const score = computeHealth(row.tags_json, row.has_cover_art === 1, ts)
        stmt.run(score, row.path)
        updated++
      }
      return updated
    })
    const updated = update()
    return { updated }
  })

  // Health breakdown: per-mandatory-tag missing counts for a set of paths
  app.post<{ Body: { paths: string[] } }>('/api/library/health-issues', async (req) => {
    const { paths } = req.body
    const config = await readConfig()
    const ts = config.tagSettings ?? {}
    const mandatory = Object.entries(ts)
      .filter(([, v]) => v === 'mandatory')
      .map(([k]) => k)
    if (mandatory.length === 0) return { issues: [], total: 0 }

    const db = getDb()
    const counts: Record<string, { missing: number; total: number }> = {}
    for (const key of mandatory) counts[key] = { missing: 0, total: 0 }

    let processed = 0
    for (const filePath of paths) {
      const row = getTrackByPath(db, filePath)
      if (!row) continue
      processed++
      const tags: Record<string, unknown> = JSON.parse(row.tags_json || '{}')
      for (const key of mandatory) {
        counts[key].total++
        if (key === 'cover_art') {
          if (row.has_cover_art !== 1) counts[key].missing++
        } else {
          const val = tags[key] ?? tags[key.toUpperCase()]
          if (!val || val === '') counts[key].missing++
        }
      }
    }

    const issues = Object.entries(counts)
      .filter(([, v]) => v.missing > 0)
      .map(([key, v]) => ({ key, missing: v.missing, total: v.total }))
      .sort((a, b) => b.missing - a.missing)

    return { issues, total: processed }
  })

  // Sweep: remove 'ignored' tags from all library files on-demand (SSE progress stream)
  app.post('/api/library/remove-ignored-tags', async (req, reply) => {
    const config = await readConfig()
    const ts = config.tagSettings ?? {}
    const ignoredKeys = Object.entries(ts)
      .filter(([k, v]) => v === 'ignored' && k !== 'cover_art')
      .map(([k]) => k)

    if (ignoredKeys.length === 0) {
      return { removed: 0, message: 'No ignored tags configured' }
    }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (data: unknown) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    const db = getDb()
    const rows = getAllTracks(db)
    const total = rows.length

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const driver = driverFor(row.path)
          const tagsToRemove: Record<string, string> = {}
          for (const key of ignoredKeys) tagsToRemove[key] = ''
          await driver.writeTags(row.path, tagsToRemove)
          await rescanFile(row.path, driver)
        } catch { /* skip unreadable files */ }
        send({ done: i + 1, total, path: row.path })
      }
    } finally {
      if (!raw.writableEnded) raw.end()
    }
  })

  app.post<{ Body: { paths: string[] } }>('/api/library/delete', async (req, reply) => {
    const { paths: filePaths } = req.body
    if (!filePaths?.length) { reply.code(400); return { error: 'paths required' } }

    const deleted: string[] = []
    const errors: Array<{ path: string; error: string }> = []

    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath)
        deleted.push(filePath)
      } catch (err: unknown) {
        errors.push({ path: filePath, error: (err as Error).message })
      }
    }

    // Remove all successfully deleted paths from DB, plus any that no longer exist on disk
    const toRemoveFromDb = [...deleted]
    for (const { path: p } of errors) {
      if ((errors.find(e => e.path === p) as any)?.error?.includes('ENOENT')) toRemoveFromDb.push(p)
    }
    const db = getDb()
    removeTracksByPaths(db, filePaths)

    // Best-effort: remove empty directories left behind
    const dirs = [...new Set(deleted.map(p => path.dirname(p)))]
    for (const dir of dirs) {
      try {
        const remaining = await fs.readdir(dir)
        if (remaining.length === 0) await fs.rmdir(dir)
      } catch { /* ignore */ }
    }

    if (errors.length > 0 && deleted.length === 0) {
      reply.code(500)
      return { error: errors[0].error, errors }
    }
    return { deleted, errors }
  })

  // Background AcoustID queue poller — checks pending submissions every 15 minutes,
  // writes acoustid_id tags once imported, drops entries older than 24 hours.
  const ACOUSTID_POLL_INTERVAL = 15 * 60 * 1000
  const ACOUSTID_BATCH_SIZE = 10

  async function pollAcoustIDQueue() {
    const db = getDb()
    const removed = removeStaleSubmissions(db)
    if (removed > 0) app.log.info({ removed }, 'acoustid-queue: removed stale submissions')

    const pending = getPendingSubmissions(db)
    if (pending.length === 0) return
    app.log.info({ count: pending.length }, 'acoustid-queue: checking pending submissions')

    for (let i = 0; i < pending.length; i += ACOUSTID_BATCH_SIZE) {
      const batch = pending.slice(i, i + ACOUSTID_BATCH_SIZE)
      const batchIds = batch.map(r => r.submission_id)
      try {
        const statuses = await getSubmissionStatus(batchIds, ACOUSTID_APP_KEY)
        updateSubmissionsChecked(db, batchIds)

        const resolved: number[] = []
        for (const status of statuses) {
          const row = batch.find(r => r.submission_id === status.id)
          if (!row) continue
          if (status.status === 'imported' && status.acoustidId) {
            try {
              const driver = driverFor(row.path)
              const tags = await driver.readTags(row.path).catch(() => ({}) as Record<string, string>)
              await driver.writeTags(row.path, { ...(tags as Record<string, string>), acoustid_id: status.acoustidId })
              await rescanFile(row.path, driver)
              app.log.info({ file: path.basename(row.path), acoustidId: status.acoustidId }, 'acoustid-queue: acoustid_id written')
            } catch (err) {
              app.log.warn({ file: path.basename(row.path), err: (err as Error).message }, 'acoustid-queue: tag write failed')
            }
            resolved.push(status.id)
          } else if (status.status === 'error') {
            app.log.warn({ id: status.id, file: path.basename(row.path) }, 'acoustid-queue: submission error, removing from queue')
            resolved.push(status.id)
          }
        }
        if (resolved.length > 0) resolveSubmissions(db, resolved)
      } catch (err) {
        app.log.warn({ err: (err as Error).message }, 'acoustid-queue: status check failed')
      }
    }
  }

  setInterval(
    () => pollAcoustIDQueue().catch(err => app.log.warn({ err: err.message }, 'acoustid-queue: poll error')),
    ACOUSTID_POLL_INTERVAL
  )
  // Check once 30s after startup to pick up any submissions from a previous session
  setTimeout(
    () => pollAcoustIDQueue().catch(err => app.log.warn({ err: err.message }, 'acoustid-queue: startup poll error')),
    30_000
  )

  startInboxWatcher(
    readConfig,
    async (paths, cfg) => {
      const job = startBatchJob(paths, cfg, { replaygain: true, promote: !!cfg.libraryPath })
      await waitForBatchJob(job.id)
    },
    (msg, err) => app.log.warn({ err }, msg),
  )

  await app.listen({ port: PORT, host: '0.0.0.0' })
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
