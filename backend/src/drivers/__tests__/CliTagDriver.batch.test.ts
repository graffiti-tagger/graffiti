import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentFlac } from '../../__tests__/helpers.js'
import { CliTagDriver } from '../CliTagDriver.js'

const driver = new CliTagDriver({ metaflac: BINS.metaflac })

let tmpDir: string

before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gt-batch-test-')) })
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

async function newFlac(name: string): Promise<string> {
  const p = join(tmpDir, name)
  await makeSilentFlac(p)
  return p
}

describe('CliTagDriver — readTagsBatch (FLAC)', () => {
  test('reads tags for multiple files in one metaflac call', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = await newFlac('batch1.flac')
    const f2 = await newFlac('batch2.flac')
    const f3 = await newFlac('batch3.flac')

    await driver.writeTags(f1, { title: 'Track 1', artist: 'Artist A', tracknumber: '1' })
    await driver.writeTags(f2, { title: 'Track 2', artist: 'Artist A', tracknumber: '2' })
    await driver.writeTags(f3, { title: 'Track 3', artist: 'Artist B', tracknumber: '1' })

    const batch = await driver.readTagsBatch([f1, f2, f3])

    assert.equal(batch.get(f1)?.title, 'Track 1')
    assert.equal(batch.get(f2)?.title, 'Track 2')
    assert.equal(batch.get(f3)?.title, 'Track 3')
    assert.equal(batch.get(f1)?.artist, 'Artist A')
    assert.equal(batch.get(f3)?.artist, 'Artist B')
  })

  test('batch result has an entry for every input file', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const files = await Promise.all([
      newFlac('entry1.flac'),
      newFlac('entry2.flac'),
      newFlac('entry3.flac'),
      newFlac('entry4.flac'),
      newFlac('entry5.flac'),
    ])
    const batch = await driver.readTagsBatch(files)
    for (const f of files) {
      assert.ok(batch.has(f), `missing entry for ${f}`)
    }
  })

  test('batch preserves UTF-8 across multiple files', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = await newFlac('utf8a.flac')
    const f2 = await newFlac('utf8b.flac')

    await driver.writeTags(f1, { album: 'Introducción a Los Hipsters' })
    await driver.writeTags(f2, { album: 'Sigur Rós' })

    const batch = await driver.readTagsBatch([f1, f2])
    assert.equal(batch.get(f1)?.album, 'Introducción a Los Hipsters')
    assert.equal(batch.get(f2)?.album, 'Sigur Rós')
  })

  test('correctly assigns tags across file boundaries (boundary detection)', async () => {
    // The batch parser uses anchor tags (artist, albumartist, etc.) to detect
    // boundaries between files. Verify tracknumber (a non-anchor) is assigned
    // to the correct file even when files share an artist.
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = await newFlac('boundary1.flac')
    const f2 = await newFlac('boundary2.flac')
    const f3 = await newFlac('boundary3.flac')

    await driver.writeTags(f1, { title: 'A', artist: 'Same', album: 'Same', tracknumber: '1' })
    await driver.writeTags(f2, { title: 'B', artist: 'Same', album: 'Same', tracknumber: '2' })
    await driver.writeTags(f3, { title: 'C', artist: 'Same', album: 'Same', tracknumber: '3' })

    const batch = await driver.readTagsBatch([f1, f2, f3])

    // tracknumber must not cross file boundaries
    assert.equal(batch.get(f1)?.tracknumber, '1')
    assert.equal(batch.get(f2)?.tracknumber, '2')
    assert.equal(batch.get(f3)?.tracknumber, '3')

    // title must be assigned to the right file
    assert.equal(batch.get(f1)?.title, 'A')
    assert.equal(batch.get(f2)?.title, 'B')
    assert.equal(batch.get(f3)?.title, 'C')
  })

  test('returns empty map for empty input', async () => {
    const batch = await driver.readTagsBatch([])
    assert.equal(batch.size, 0)
  })
})

describe('CliTagDriver — writeTagsBatch (FLAC)', () => {
  test('writes shared tags to multiple files', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = await newFlac('wbatch1.flac')
    const f2 = await newFlac('wbatch2.flac')

    const sharedTags = { albumartist: 'Shared Artist', album: 'Shared Album', date: '2024', genre: 'Pop' }
    await driver.writeTagsBatch([f1, f2], sharedTags)

    const t1 = await driver.readTags(f1)
    const t2 = await driver.readTags(f2)

    assert.equal(t1.albumartist, 'Shared Artist')
    assert.equal(t2.albumartist, 'Shared Artist')
    assert.equal(t1.album, 'Shared Album')
    assert.equal(t2.album, 'Shared Album')
    assert.equal(t1.genre, 'Pop')
    assert.equal(t2.genre, 'Pop')
  })

  test('writeTagsBatch UTF-8 values are stored correctly', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = await newFlac('wutf8a.flac')
    const f2 = await newFlac('wutf8b.flac')

    await driver.writeTagsBatch([f1, f2], { albumartist: 'Björk', album: 'Homogénic' })

    const t1 = await driver.readTags(f1)
    const t2 = await driver.readTags(f2)

    assert.equal(t1.albumartist, 'Björk')
    assert.equal(t2.albumartist, 'Björk')
    assert.equal(t1.album, 'Homogénic')
    assert.equal(t2.album, 'Homogénic')
  })
})

describe('CliTagDriver — readDurationsBatch (FLAC)', () => {
  test('returns duration for each file', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = await newFlac('dur1.flac')
    const f2 = await newFlac('dur2.flac')

    const durs = await driver.readDurationsBatch([f1, f2])
    assert.ok(durs.has(f1))
    assert.ok(durs.has(f2))

    const d1 = durs.get(f1)
    assert.ok(d1 && d1.includes(':'), `Expected duration string, got: ${d1}`)
  })
})
