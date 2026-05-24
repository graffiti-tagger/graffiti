// Shared test helpers — imported by test files, not a test file itself.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import Database from 'better-sqlite3'

export const execFileP = promisify(execFile)

// Absolute paths to tools used in tests. Tests skip themselves when the
// required binary is absent rather than failing the suite.
export const BINS = {
  metaflac:  '/opt/homebrew/bin/metaflac',
  ffmpeg:    '/opt/homebrew/bin/ffmpeg',
  ffprobe:   '/opt/homebrew/bin/ffprobe',
  fpcalc:    '/opt/homebrew/bin/fpcalc',
  rsgain:    '/opt/homebrew/bin/rsgain',
  vorbiscomment: '/opt/homebrew/bin/vorbiscomment',
  AtomicParsley: '/opt/homebrew/bin/AtomicParsley',
}

export async function hasBin(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false)
}

/** Create a silent FLAC file (mono, 44.1 kHz). Default duration is 1 second. */
export async function makeSilentFlac(destPath: string, durationSecs = 1): Promise<void> {
  await execFileP(BINS.ffmpeg, [
    '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSecs}`,
    '-ac', '1', '-ar', '44100',
    destPath,
  ], { env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } })
}

/** Create a silent MP3 file (mono, 44.1 kHz, 128 kbps). Default duration is 1 second. */
export async function makeSilentMp3(destPath: string, durationSecs = 1): Promise<void> {
  await execFileP(BINS.ffmpeg, [
    '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSecs}`,
    '-ac', '1', '-ar', '44100', '-b:a', '128k',
    destPath,
  ])
}

/** Create a 1-second silent OGG file. */
export async function makeSilentOgg(destPath: string): Promise<void> {
  await execFileP(BINS.ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-ac', '1', '-ar', '44100',
    '-c:a', 'libvorbis', '-q:a', '3',
    destPath,
  ])
}

/** Create a 1-second silent M4A file. */
export async function makeSilentM4a(destPath: string): Promise<void> {
  await execFileP(BINS.ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-ac', '1', '-ar', '44100',
    '-c:a', 'aac', '-b:a', '128k',
    destPath,
  ])
}

/** Schema SQL mirroring db.ts migrate(). Used to create isolated test DBs. */
const SCHEMA_SQL = `
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
    scanned_at       INTEGER DEFAULT (unixepoch()),
    health_score     INTEGER,
    has_cover_art    INTEGER
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
`

/** Create a fully-migrated in-memory SQLite database for testing. */
export function makeTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
}

/** A minimal valid JSON fetch response. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
