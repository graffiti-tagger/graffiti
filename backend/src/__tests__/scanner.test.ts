// Must set GT_DATA_DIR before any db.ts import so the singleton uses our temp path
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { BINS, hasBin, makeSilentFlac } from './helpers.js'

// Point the DB singleton at a temp dir unique to this test file
const dbDir = join(tmpdir(), `gt-scanner-db-${Date.now()}`)
process.env.GT_DATA_DIR = dbDir

import { getDb } from '../db.js'
import { rescanFile, scanLibrary, rebuildLibrary } from '../scanner.js'
import { CliTagDriver } from '../drivers/CliTagDriver.js'
import { mkdirSync } from 'node:fs'

mkdirSync(dbDir, { recursive: true })

const driver = new CliTagDriver({ metaflac: BINS.metaflac })

let tmpLib: string

before(async () => {
  tmpLib = await mkdtemp(join(tmpdir(), 'gt-scanner-lib-'))
  // Prime the DB singleton using our tmp dir
  getDb()
})

after(async () => {
  await rm(tmpLib, { recursive: true, force: true })
  await rm(dbDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Clear tracks between tests for isolation
  getDb().prepare('DELETE FROM tracks').run()
})

describe('rescanFile', () => {
  test('inserts a new track into the DB', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f = join(tmpLib, 'rescan1.flac')
    await makeSilentFlac(f)
    await driver.writeTags(f, { title: 'Rescan Track', artist: 'Rescan Artist', tracknumber: '1' })

    await rescanFile(f, driver)

    const db = getDb()
    const row = db.prepare('SELECT * FROM tracks WHERE path = ?').get(f) as { title: string; artist: string } | undefined
    assert.ok(row, 'track should be in DB after rescanFile')
    assert.equal(row.title, 'Rescan Track')
    assert.equal(row.artist, 'Rescan Artist')
  })

  test('updates an existing track when called again', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f = join(tmpLib, 'rescan2.flac')
    await makeSilentFlac(f)
    await driver.writeTags(f, { title: 'Before' })
    await rescanFile(f, driver)

    await driver.writeTags(f, { title: 'After' })
    await rescanFile(f, driver)

    const db = getDb()
    const row = db.prepare('SELECT * FROM tracks WHERE path = ?').get(f) as { title: string } | undefined
    assert.equal(row?.title, 'After')
  })
})

describe('scanLibrary', () => {
  test('discovers FLAC files and inserts them', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const dir = join(tmpLib, 'scan-lib')
    mkdirSync(dir, { recursive: true })

    const f1 = join(dir, 'track1.flac')
    const f2 = join(dir, 'track2.flac')
    await makeSilentFlac(f1)
    await makeSilentFlac(f2)
    await driver.writeTags(f1, { title: 'T1', artist: 'A', tracknumber: '1' })
    await driver.writeTags(f2, { title: 'T2', artist: 'A', tracknumber: '2' })

    const result = await scanLibrary(dir, driver)

    assert.equal(result.added, 2)
    assert.equal(result.scanned, 2)
    assert.equal(result.errors, 0)
    assert.ok(result.durationMs >= 0)

    const db = getDb()
    const count = (db.prepare('SELECT COUNT(*) as c FROM tracks WHERE path LIKE ?').get(`${dir}%`) as { c: number }).c
    assert.equal(count, 2)
  })

  test('skips unchanged files on second scan (mtime unchanged)', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const dir = join(tmpLib, 'scan-skip')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'skip.flac')
    await makeSilentFlac(f)

    const first = await scanLibrary(dir, driver)
    assert.equal(first.added, 1)

    const second = await scanLibrary(dir, driver)
    assert.equal(second.added, 0)
    assert.equal(second.updated, 0)
    assert.equal(second.skipped, 1)
  })

  test('updates a file when mtime changes', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const dir = join(tmpLib, 'scan-update')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'update.flac')
    await makeSilentFlac(f)
    await driver.writeTags(f, { title: 'Original' })

    await scanLibrary(dir, driver)

    // Write new tags first, then bump mtime via utimes so the final mtime on disk
    // is guaranteed to differ from what the first scan stored. (writeTags itself
    // updates mtime, but only to "now", which may still be the same second.)
    await driver.writeTags(f, { title: 'Updated' })
    const now = new Date()
    const future = new Date(now.getTime() + 2000)
    await utimes(f, future, future)

    const second = await scanLibrary(dir, driver)
    assert.equal(second.updated, 1)
    assert.equal(second.skipped, 0)

    const db = getDb()
    const row = db.prepare('SELECT title FROM tracks WHERE path = ?').get(f) as { title: string } | undefined
    assert.equal(row?.title, 'Updated')
  })

  test('removes DB entries for files deleted from disk', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const dir = join(tmpLib, 'scan-remove')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'gone.flac')
    await makeSilentFlac(f)

    await scanLibrary(dir, driver)
    const db = getDb()
    const before = db.prepare('SELECT COUNT(*) as c FROM tracks WHERE path = ?').get(f) as { c: number }
    assert.equal(before.c, 1)

    await rm(f)
    const result = await scanLibrary(dir, driver)
    assert.equal(result.removed, 1)

    const after = db.prepare('SELECT COUNT(*) as c FROM tracks WHERE path = ?').get(f) as { c: number }
    assert.equal(after.c, 0)
  })
})

describe('rebuildLibrary', () => {
  test('wipes existing tracks and rescans', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const dir = join(tmpLib, 'rebuild')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'rebuild.flac')
    await makeSilentFlac(f)

    // Insert a stale entry manually
    const db = getDb()
    db.prepare(`
      INSERT INTO tracks (path, format, tags_json) VALUES ('/stale/path.flac', 'flac', '{}')
    `).run()

    const result = await rebuildLibrary(dir, driver)

    assert.equal(result.added, 1)
    // Stale entry should be gone
    const stale = db.prepare('SELECT 1 FROM tracks WHERE path = ?').get('/stale/path.flac')
    assert.equal(stale, undefined)
  })
})
