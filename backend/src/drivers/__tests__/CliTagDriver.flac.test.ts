import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentFlac } from '../../__tests__/helpers.js'
import { CliTagDriver } from '../CliTagDriver.js'

const driver = new CliTagDriver({ metaflac: BINS.metaflac })

let tmpDir: string
let flacFile: string

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gt-flac-test-'))
})
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

async function newFlac(name = `track-${Date.now()}.flac`): Promise<string> {
  const p = join(tmpDir, name)
  await makeSilentFlac(p)
  return p
}

describe('CliTagDriver — FLAC canHandle', () => {
  test('accepts .flac extension (case insensitive)', () => {
    assert.ok(driver.canHandle('/path/to/track.flac'))
    assert.ok(driver.canHandle('/path/to/track.FLAC'))
  })

  test('rejects non-audio paths', () => {
    assert.ok(!driver.canHandle('/path/to/file.txt'))
    assert.ok(!driver.canHandle('/path/to/file.jpg'))
    assert.ok(!driver.canHandle('/path/to/noextension'))
  })
})

describe('CliTagDriver — FLAC basic read/write round-trip', () => {
  test('writes and reads back standard tags', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, {
      title: 'Test Track',
      artist: 'Test Artist',
      albumartist: 'Test Album Artist',
      album: 'Test Album',
      tracknumber: '3',
      discnumber: '1',
      date: '2024',
      genre: 'Electronic',
    })

    const tags = await driver.readTags(f)
    assert.equal(tags.title, 'Test Track')
    assert.equal(tags.artist, 'Test Artist')
    assert.equal(tags.albumartist, 'Test Album Artist')
    assert.equal(tags.album, 'Test Album')
    assert.equal(tags.tracknumber, '3')
    assert.equal(tags.discnumber, '1')
    assert.equal(tags.date, '2024')
    assert.equal(tags.genre, 'Electronic')
  })

  test('overwrites existing tags correctly', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, { title: 'Original' })
    await driver.writeTags(f, { title: 'Updated' })
    const tags = await driver.readTags(f)
    assert.equal(tags.title, 'Updated')
  })

  test('preserves existing tags not in the write set', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, { title: 'My Title', artist: 'My Artist' })
    // Write only album — title/artist should persist (metaflac removes+sets per-key)
    await driver.writeTags(f, { album: 'My Album' })
    const tags = await driver.readTags(f)
    assert.equal(tags.album, 'My Album')
    // title/artist are preserved because --remove-tag only removes the tags being written
    assert.equal(tags.title, 'My Title')
    assert.equal(tags.artist, 'My Artist')
  })

  test('reads empty tag map from a freshly-encoded file', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()
    const tags = await driver.readTags(f)
    // ffmpeg injects an "encoder" comment; no music tags should be present
    assert.equal(tags.title, undefined)
    assert.equal(tags.artist, undefined)
  })

  test('handles MusicBrainz UUID tags', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, {
      musicbrainz_recordingid: 'abc-123-def',
      musicbrainz_releaseid: 'rel-456',
      acoustid_id: 'acid-789',
    })
    const tags = await driver.readTags(f)
    assert.equal(tags.musicbrainz_recordingid, 'abc-123-def')
    assert.equal(tags.musicbrainz_releaseid, 'rel-456')
    assert.equal(tags.acoustid_id, 'acid-789')
  })

  test('handles ReplayGain tags', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, {
      replaygain_track_gain: '-6.50 dB',
      replaygain_track_peak: '0.985674',
      replaygain_album_gain: '-5.20 dB',
      replaygain_album_peak: '0.999999',
    })
    const tags = await driver.readTags(f)
    assert.equal(tags.replaygain_track_gain, '-6.50 dB')
    assert.equal(tags.replaygain_track_peak, '0.985674')
    assert.equal(tags.replaygain_album_gain, '-5.20 dB')
    assert.equal(tags.replaygain_album_peak, '0.999999')
  })
})

describe('CliTagDriver — FLAC multi-value tags', () => {
  test('writes and reads an array value as multiple Vorbis comments', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, { artist: ['Lead Artist', 'Featured Artist'] })
    const tags = await driver.readTags(f)
    assert.ok(Array.isArray(tags.artist), 'multi-value tag should be an array')
    const arr = tags.artist as string[]
    assert.ok(arr.includes('Lead Artist'))
    assert.ok(arr.includes('Featured Artist'))
  })
})

describe('CliTagDriver — FLAC UTF-8', () => {
  test('accented characters survive round-trip', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, { album: 'Ágætis byrjun', artist: 'Sigur Rós' })
    const tags = await driver.readTags(f)
    assert.equal(tags.album, 'Ágætis byrjun')
    assert.equal(tags.artist, 'Sigur Rós')
  })

  test('Leftöver Crack survives round-trip as artist and albumartist', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()

    await driver.writeTags(f, {
      artist: 'Leftöver Crack',
      albumartist: 'Leftöver Crack',
    })
    const tags = await driver.readTags(f)

    // Dump raw bytes to diagnose any silent corruption
    const artistHex = Buffer.from(tags.artist as string ?? '', 'utf8').toString('hex')
    const expectedHex = Buffer.from('Leftöver Crack', 'utf8').toString('hex')
    assert.equal(artistHex, expectedHex,
      `artist bytes mismatch — got: ${artistHex}  want: ${expectedHex}`)

    assert.equal(tags.artist, 'Leftöver Crack')
    assert.equal(tags.albumartist, 'Leftöver Crack')
  })
})

describe('CliTagDriver — FLAC readFileInfo', () => {
  test('returns flac format and a duration string', async () => {
    if (!(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return
    const f = await newFlac()
    const info = await driver.readFileInfo(f)
    assert.equal(info.format, 'flac')
    assert.equal(info.path, f)
    assert.ok(typeof info.duration === 'string' && info.duration.includes(':'),
      `Expected duration string, got: ${info.duration}`)
  })
})
