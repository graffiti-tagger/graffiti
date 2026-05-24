import fs from 'fs/promises'
import path from 'path'
import { ITagDriver, TagMap } from './drivers/ITagDriver.js'
import { getDb, upsertTrack, getTrackByPath, removeOrphanedTracks, TrackRow } from './db.js'
import { readConfig } from './config.js'
import { computeHealth } from './pipeline/health.js'
import { hasEmbeddedArt } from './pipeline/process.js'

const AUDIO_EXTS = new Set(['.flac', '.mp3', '.ogg', '.m4a'])

export interface ScanResult {
  scanned: number
  added: number
  updated: number
  skipped: number
  errors: number
  removed: number
  durationMs: number
}

async function walkAudioFiles(dir: string): Promise<string[]> {
  const results: string[] = []

  async function walk(current: string) {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.resolve(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        results.push(full)
      }
    }
  }

  await walk(dir)
  return results
}

function firstStr(tags: TagMap, key: string): string | null {
  const v = tags[key]
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function rescanFile(filePath: string, driver: ITagDriver): Promise<void> {
  const db = getDb()
  const cfg = await readConfig()
  const existing = getTrackByPath(db, filePath)
  const [stat, tags, info, hasCoverArt] = await Promise.all([
    fs.stat(filePath),
    driver.readTags(filePath),
    driver.readFileInfo(filePath),
    hasEmbeddedArt(filePath),
  ])
  const ext = path.extname(filePath).toLowerCase().slice(1)
  const tagsJson = JSON.stringify(tags)
  upsertTrack(db, {
    path:        filePath,
    format:      ext,
    file_size:      stat.size,
    file_mtime:     Math.floor(stat.mtimeMs / 1000),
    file_birthtime: Math.floor((stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs) / 1000),
    title:          firstStr(tags, 'title'),
    artist:         firstStr(tags, 'artist'),
    albumartist:    firstStr(tags, 'albumartist'),
    album:          firstStr(tags, 'album'),
    tracknumber:    firstStr(tags, 'tracknumber'),
    discnumber:     firstStr(tags, 'discnumber'),
    date:           firstStr(tags, 'date'),
    genre:          firstStr(tags, 'genre'),
    duration:       info.duration ?? existing?.duration ?? null,
    tags_json:      tagsJson,
    has_cover_art:  hasCoverArt ? 1 : 0,
    health_score:   computeHealth(tagsJson, hasCoverArt, cfg.tagSettings ?? {}),
  } as Omit<TrackRow, 'id' | 'scanned_at'>)
}

export async function rebuildLibrary(
  libraryPath: string,
  driver: ITagDriver
): Promise<ScanResult> {
  getDb().prepare('DELETE FROM tracks').run()
  return scanLibrary(libraryPath, driver)
}

export async function scanLibrary(
  libraryPath: string,
  driver: ITagDriver
): Promise<ScanResult> {
  const start = Date.now()
  const db = getDb()
  const cfg = await readConfig()
  const result: ScanResult = {
    scanned: 0, added: 0, updated: 0, skipped: 0, errors: 0, removed: 0, durationMs: 0,
  }

  const allFiles = await walkAudioFiles(libraryPath)

  // Group by directory — FLAC batch reads operate per-directory
  const byDir = new Map<string, string[]>()
  for (const f of allFiles) {
    const dir = path.dirname(f)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir)!.push(f)
  }

  for (const [, dirFiles] of byDir) {
    // Stat all files in the directory up front
    const stats = await Promise.all(dirFiles.map(f => fs.stat(f).catch(() => null)))

    // Separate files that need scanning from those that are unchanged
    const toScan: string[] = []
    for (let i = 0; i < dirFiles.length; i++) {
      const stat = stats[i]
      if (!stat) { result.errors++; continue }

      const mtime = Math.floor(stat.mtimeMs / 1000)
      const existing = getTrackByPath(db, dirFiles[i])

      if (existing && existing.file_mtime === mtime) {
        result.skipped++
      } else {
        toScan.push(dirFiles[i])
      }
    }

    if (toScan.length === 0) continue

    // Batch read tags, durations, and cover art for all files that need it
    let tagMap: Map<string, TagMap>
    let durationMap: Map<string, string | null>
    let coverArtMap: Map<string, boolean>
    try {
      const [tags, durations, artResults] = await Promise.all([
        driver.readTagsBatch(toScan),
        driver.readDurationsBatch(toScan),
        Promise.all(toScan.map(async f => [f, await hasEmbeddedArt(f)] as [string, boolean])),
      ])
      tagMap = tags
      durationMap = durations
      coverArtMap = new Map(artResults)
    } catch (err) {
      console.error(`Scan error in ${path.dirname(toScan[0])}:`, err)
      result.errors += toScan.length
      continue
    }

    // Upsert the whole directory in a single transaction
    db.transaction(() => {
      for (const filePath of toScan) {
        const tags = tagMap.get(filePath) ?? {}
        const statIdx = dirFiles.indexOf(filePath)
        const stat = stats[statIdx]
        if (!stat) continue

        const existing = getTrackByPath(db, filePath)
        const isNew = !existing
        const ext = path.extname(filePath).toLowerCase().slice(1)
        const tagsJson = JSON.stringify(tags)
        const hasCoverArt = coverArtMap.get(filePath) ?? false

        upsertTrack(db, {
          path:        filePath,
          format:      ext,
          file_size:      stat.size,
          file_mtime:     Math.floor(stat.mtimeMs / 1000),
          file_birthtime: Math.floor((stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs) / 1000),
          title:          firstStr(tags, 'title'),
          artist:         firstStr(tags, 'artist'),
          albumartist:    firstStr(tags, 'albumartist'),
          album:          firstStr(tags, 'album'),
          tracknumber:    firstStr(tags, 'tracknumber'),
          discnumber:     firstStr(tags, 'discnumber'),
          date:           firstStr(tags, 'date'),
          genre:          firstStr(tags, 'genre'),
          duration:       durationMap.get(filePath) ?? null,
          tags_json:      tagsJson,
          has_cover_art:  hasCoverArt ? 1 : 0,
          health_score:   computeHealth(tagsJson, hasCoverArt, cfg.tagSettings ?? {}),
        } as Omit<TrackRow, 'id' | 'scanned_at'>)

        if (isNew) result.added++
        else result.updated++
        result.scanned++
      }
    })()
  }

  // Remove DB rows for files that no longer exist on disk
  result.removed = removeOrphanedTracks(db, allFiles)

  result.durationMs = Date.now() - start
  return result
}
