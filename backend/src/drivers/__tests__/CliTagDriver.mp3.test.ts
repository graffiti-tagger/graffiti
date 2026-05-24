import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentMp3 } from '../../__tests__/helpers.js'
import { CliTagDriver } from '../CliTagDriver.js'

const driver = new CliTagDriver({ metaflac: BINS.metaflac })

let tmpDir: string

before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gt-mp3-test-')) })
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

async function newMp3(name = `track-${Date.now()}.mp3`): Promise<string> {
  const p = join(tmpDir, name)
  await makeSilentMp3(p)
  return p
}

describe('CliTagDriver — MP3 canHandle', () => {
  test('accepts .mp3 extension', () => {
    assert.ok(driver.canHandle('/path/to/track.mp3'))
    assert.ok(driver.canHandle('/path/to/track.MP3'))
  })
})

describe('CliTagDriver — MP3 basic read/write round-trip', () => {
  test('writes and reads back standard ID3v2 tags', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = await newMp3()

    await driver.writeTags(f, {
      title: 'MP3 Track',
      artist: 'MP3 Artist',
      albumartist: 'MP3 Album Artist',
      album: 'MP3 Album',
      tracknumber: '5',
      date: '2023',
      genre: 'Jazz',
    })

    const tags = await driver.readTags(f)
    assert.equal(tags.title, 'MP3 Track')
    assert.equal(tags.artist, 'MP3 Artist')
    assert.equal(tags.album, 'MP3 Album')
    assert.equal(tags.tracknumber, '5')
    assert.equal(tags.genre, 'Jazz')
  })

  test('reads empty tags from a freshly-encoded MP3', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = await newMp3()
    const tags = await driver.readTags(f)
    // A freshly encoded MP3 should have no artist/title set
    assert.equal(tags.title, undefined)
    assert.equal(tags.artist, undefined)
  })

  test('overwrites an existing tag', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = await newMp3()
    await driver.writeTags(f, { title: 'First' })
    await driver.writeTags(f, { title: 'Second' })
    const tags = await driver.readTags(f)
    assert.equal(tags.title, 'Second')
  })

  test('readFileInfo returns mp3 format', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = await newMp3()
    const info = await driver.readFileInfo(f)
    assert.equal(info.format, 'mp3')
  })
})

describe('CliTagDriver — MP3 TXXX frames (custom tags via node-id3)', () => {
  test('writes and reads back a custom TXXX tag', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = await newMp3()

    // musicbrainz_recordingid is not a standard ID3 frame — goes through node-id3 TXXX
    await driver.writeTags(f, { musicbrainz_recordingid: 'rec-uuid-mp3' })
    const tags = await driver.readTags(f)
    assert.equal(tags.musicbrainz_recordingid, 'rec-uuid-mp3')
  })

  test('writes acoustid_id as a TXXX frame', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = await newMp3()
    await driver.writeTags(f, { acoustid_id: 'acid-uuid-mp3' })
    const tags = await driver.readTags(f)
    assert.equal(tags.acoustid_id, 'acid-uuid-mp3')
  })
})
