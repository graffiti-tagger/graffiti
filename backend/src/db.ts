import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

function dbPath(): string {
  const dir = process.env.GT_DATA_DIR
    ?? path.join(os.homedir(), '.local', 'share', 'graffiti-tagger')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'library.db')
}

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath())
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    migrate(_db)
  }
  return _db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS track_tag_prefs (
      path    TEXT NOT NULL,
      tag_key TEXT NOT NULL,
      PRIMARY KEY (path, tag_key)
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      path             TEXT UNIQUE NOT NULL,
      format           TEXT NOT NULL,
      file_size        INTEGER,
      file_mtime       INTEGER,
      file_birthtime   INTEGER,
      title            TEXT,
      artist           TEXT,
      albumartist      TEXT,
      album            TEXT,
      tracknumber      TEXT,
      discnumber       TEXT,
      date             TEXT,
      genre            TEXT,
      duration         TEXT,
      tags_json        TEXT NOT NULL DEFAULT '{}',
      scanned_at       INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_albumartist ON tracks (albumartist COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_tracks_album       ON tracks (album COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist      ON tracks (artist COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS acoustid_submission_queue (
      submission_id   INTEGER PRIMARY KEY,
      path            TEXT NOT NULL,
      submitted_at    INTEGER NOT NULL,
      last_checked_at INTEGER
    );
  `)
  // Additive migrations for existing databases
  try { db.exec(`ALTER TABLE tracks ADD COLUMN file_birthtime INTEGER`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tracks ADD COLUMN health_score INTEGER`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tracks ADD COLUMN has_cover_art INTEGER`) } catch { /* already exists */ }
}

export interface TrackRow {
  id: number
  path: string
  format: string
  file_size: number | null
  file_mtime: number | null
  file_birthtime: number | null
  title: string | null
  artist: string | null
  albumartist: string | null
  album: string | null
  tracknumber: string | null
  discnumber: string | null
  date: string | null
  genre: string | null
  duration: string | null
  tags_json: string
  scanned_at: number
  health_score?: number | null
  has_cover_art?: number | null  // 0/1/NULL(=unchecked)
}

export function upsertTrack(
  db: Database.Database,
  track: Omit<TrackRow, 'id' | 'scanned_at'>
): void {
  db.prepare(`
    INSERT INTO tracks
      (path, format, file_size, file_mtime, file_birthtime, title, artist, albumartist,
       album, tracknumber, discnumber, date, genre, duration, tags_json,
       health_score, has_cover_art)
    VALUES
      (@path, @format, @file_size, @file_mtime, @file_birthtime, @title, @artist, @albumartist,
       @album, @tracknumber, @discnumber, @date, @genre, @duration, @tags_json,
       @health_score, @has_cover_art)
    ON CONFLICT(path) DO UPDATE SET
      format         = excluded.format,
      file_size      = excluded.file_size,
      file_mtime     = excluded.file_mtime,
      file_birthtime = excluded.file_birthtime,
      title          = excluded.title,
      artist         = excluded.artist,
      albumartist    = excluded.albumartist,
      album          = excluded.album,
      tracknumber    = excluded.tracknumber,
      discnumber     = excluded.discnumber,
      date           = excluded.date,
      genre          = excluded.genre,
      duration       = excluded.duration,
      tags_json      = excluded.tags_json,
      health_score   = excluded.health_score,
      has_cover_art  = excluded.has_cover_art,
      scanned_at     = unixepoch()
  `).run(track)
}

export function getTrackByPath(db: Database.Database, filePath: string): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE path = ?').get(filePath) as TrackRow | undefined
}

export function getAllTracks(db: Database.Database): TrackRow[] {
  return db.prepare(`
    SELECT * FROM tracks
    ORDER BY
      LOWER(COALESCE(albumartist, artist, '')),
      LOWER(COALESCE(album, '')),
      -- parse leading integer from tracknumber (handles "03" and "3/11")
      CAST(tracknumber AS INTEGER)
  `).all() as TrackRow[]
}

export function removeOrphanedTracks(db: Database.Database, knownPaths: string[]): number {
  if (knownPaths.length === 0) {
    const result = db.prepare('DELETE FROM tracks').run()
    return result.changes
  }
  const placeholders = knownPaths.map(() => '?').join(',')
  const result = db.prepare(
    `DELETE FROM tracks WHERE path NOT IN (${placeholders})`
  ).run(...knownPaths)
  return result.changes
}

export function removeTracksByPaths(db: Database.Database, paths: string[]): number {
  if (paths.length === 0) return 0
  const placeholders = paths.map(() => '?').join(',')
  const result = db.prepare(`DELETE FROM tracks WHERE path IN (${placeholders})`).run(...paths)
  return result.changes
}

export function getTagPrefs(db: Database.Database, paths: string[]): Map<string, Set<string>> {
  if (paths.length === 0) return new Map()
  const placeholders = paths.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT path, tag_key FROM track_tag_prefs WHERE path IN (${placeholders})`
  ).all(...paths) as { path: string; tag_key: string }[]
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!map.has(row.path)) map.set(row.path, new Set())
    map.get(row.path)!.add(row.tag_key)
  }
  return map
}

export function upsertTagPrefs(db: Database.Database, prefs: Array<{ path: string; tagKey: string }>): void {
  if (prefs.length === 0) return
  const stmt = db.prepare('INSERT OR IGNORE INTO track_tag_prefs (path, tag_key) VALUES (?, ?)')
  for (const { path, tagKey } of prefs) stmt.run(path, tagKey)
}

export function deleteTagPrefs(db: Database.Database, items: Array<{ path: string; tagKey: string }>): void {
  if (items.length === 0) return
  const stmt = db.prepare('DELETE FROM track_tag_prefs WHERE path = ? AND tag_key = ?')
  for (const { path, tagKey } of items) stmt.run(path, tagKey)
}

// --- AcoustID submission queue ---

export interface AcoustIDQueueRow {
  submission_id: number
  path: string
  submitted_at: number
  last_checked_at: number | null
}

export function insertPendingSubmissions(db: Database.Database, items: Array<{ submissionId: number; path: string }>): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO acoustid_submission_queue (submission_id, path, submitted_at) VALUES (?, ?, unixepoch())'
  )
  for (const { submissionId, path } of items) stmt.run(submissionId, path)
}

export function getPendingSubmissions(db: Database.Database): AcoustIDQueueRow[] {
  return db.prepare(
    'SELECT * FROM acoustid_submission_queue WHERE submitted_at > unixepoch() - 86400 ORDER BY submitted_at'
  ).all() as AcoustIDQueueRow[]
}

export function hasPathInQueue(db: Database.Database, filePath: string): boolean {
  return db.prepare(
    'SELECT 1 FROM acoustid_submission_queue WHERE path = ? AND submitted_at > unixepoch() - 86400'
  ).get(filePath) != null
}

export function resolveSubmissions(db: Database.Database, submissionIds: number[]): void {
  if (submissionIds.length === 0) return
  const ph = submissionIds.map(() => '?').join(',')
  db.prepare(`DELETE FROM acoustid_submission_queue WHERE submission_id IN (${ph})`).run(...submissionIds)
}

export function updateSubmissionsChecked(db: Database.Database, submissionIds: number[]): void {
  if (submissionIds.length === 0) return
  const ph = submissionIds.map(() => '?').join(',')
  db.prepare(
    `UPDATE acoustid_submission_queue SET last_checked_at = unixepoch() WHERE submission_id IN (${ph})`
  ).run(...submissionIds)
}

export function removeStaleSubmissions(db: Database.Database): number {
  return db.prepare(
    'DELETE FROM acoustid_submission_queue WHERE submitted_at <= unixepoch() - 86400'
  ).run().changes
}

// --- Tree / API shapes ---

export interface TrackSummary {
  id: number
  path: string
  n: number
  title: string
  fmt: string
  dur: string
  health: number | null
}

export interface AlbumSummary {
  name: string
  year: string | null
  genre: string | null
  tracks: TrackSummary[]
}

export interface ArtistSummary {
  artist: string
  albums: AlbumSummary[]
}

function parseTrackNum(tn: string | null): number {
  if (!tn) return 0
  return parseInt(tn.split('/')[0]) || 0
}

export function getLibraryTree(db: Database.Database): ArtistSummary[] {
  const rows = getAllTracks(db)

  const artistMap = new Map<string, Map<string, TrackRow[]>>()
  for (const row of rows) {
    const artist = row.albumartist || row.artist || 'Unknown Artist'
    const album  = row.album || 'Unknown Album'
    if (!artistMap.has(artist)) artistMap.set(artist, new Map())
    const albums = artistMap.get(artist)!
    if (!albums.has(album)) albums.set(album, [])
    albums.get(album)!.push(row)
  }

  return [...artistMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([artist, albums]) => ({
      artist,
      albums: [...albums.entries()]
        .sort(([, ta], [, tb]) => {
          const ya = ta[0]?.date?.slice(0, 4) ?? ''
          const yb = tb[0]?.date?.slice(0, 4) ?? ''
          return ya.localeCompare(yb)
        })
        .map(([name, tracks]) => ({
          name,
          year: tracks[0]?.date?.slice(0, 4) ?? null,
          genre: tracks[0]?.genre ?? null,
          tracks: tracks
            .sort((a, b) => parseTrackNum(a.tracknumber) - parseTrackNum(b.tracknumber))
            .map(t => ({
              id: t.id,
              path: t.path,
              n: parseTrackNum(t.tracknumber),
              title: t.title ?? '',
              fmt: t.format.toUpperCase(),
              dur: t.duration ?? '',
              health: t.health_score ?? null,
            })),
        })),
    }))
}

// Translate lowercase vorbis comment keys (as stored in tags_json) to the
// logical keys used by the frontend TAGS schema (src/data/tags.js).
const VORBIS_TO_LOGICAL: Record<string, string> = {
  replaygain_track_gain:      'rg_track_gain',
  replaygain_track_peak:      'rg_track_peak',
  replaygain_album_gain:      'rg_album_gain',
  replaygain_album_peak:      'rg_album_peak',
  musicbrainz_recordingid:    'mb_recordingid',
  musicbrainz_releaseid:      'mb_releaseid',
  musicbrainz_albumid:        'mb_releaseid',       // Picard legacy alias
  musicbrainz_artistid:       'mb_artistid',
  musicbrainz_albumartistid:  'mb_artistid',        // Picard legacy alias
  musicbrainz_releasegroupid: 'mb_releasegroupid',
  musicbrainz_albumreleasegroupid: 'mb_releasegroupid',
  musicbrainz_trackid:        'mb_trackid',
  musicbrainz_releasetrackid: 'mb_trackid',         // Picard legacy alias
  acoustid_id:                'acoustid_id',
  acoustid_fingerprint:       'acoustid_fingerprint',
  encoded_by:                 'encoder',
  initialkey:                 'key',
}

export function trackToApiRow(row: TrackRow): Record<string, unknown> {
  const rawTags = JSON.parse(row.tags_json || '{}')
  const extraTags: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawTags)) {
    extraTags[VORBIS_TO_LOGICAL[k] ?? k] = v
  }
  return {
    ...extraTags,
    id: row.id,
    path: row.path,
    fmt: row.format.toUpperCase(),
    dur: row.duration ?? '',
    file_size:      row.file_size ?? 0,
    file_birthtime: row.file_birthtime ?? null,
    scanned_at:     row.scanned_at,
    title:       row.title ?? '',
    artist:      row.artist ?? '',
    albumartist: row.albumartist ?? '',
    album:       row.album ?? '',
    tracknumber: row.tracknumber ?? '',
    discnumber:  row.discnumber ?? '',
    date:        row.date ?? '',
    genre:       row.genre ?? '',
    health:      row.health_score ?? null,
  }
}
