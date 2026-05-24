import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentFlac } from '../../__tests__/helpers.js'
import { runReplayGain } from '../replaygain.js'
import { CliTagDriver } from '../../drivers/CliTagDriver.js'

const driver = new CliTagDriver({ metaflac: BINS.metaflac })

let tmpDir: string
before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gt-rg-test-')) })
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

describe('runReplayGain', () => {
  test('does nothing for empty file list', async () => {
    // Should resolve without error
    await runReplayGain([], BINS.rsgain, 'r128')
  })

  test('writes ReplayGain r128 tags to a FLAC file', async () => {
    if (!(await hasBin(BINS.rsgain)) || !(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f = join(tmpDir, 'rg.flac')
    await makeSilentFlac(f)

    await runReplayGain([f], BINS.rsgain, 'r128')

    const tags = await driver.readTags(f)
    assert.ok('replaygain_track_gain' in tags,
      `Expected replaygain_track_gain, got tags: ${JSON.stringify(Object.keys(tags))}`)
    assert.ok('replaygain_track_peak' in tags)
    assert.ok('replaygain_album_gain' in tags)
    assert.ok('replaygain_album_peak' in tags)

    // R128 targets -23 LUFS — gain values should be strings ending in " dB"
    const gain = String(tags.replaygain_track_gain)
    assert.ok(gain.endsWith(' dB'), `Expected gain to end with " dB", got: ${gain}`)
  })

  test('writes ReplayGain legacy tags to a FLAC file', async () => {
    if (!(await hasBin(BINS.rsgain)) || !(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f = join(tmpDir, 'rg-legacy.flac')
    await makeSilentFlac(f)

    await runReplayGain([f], BINS.rsgain, 'legacy')

    const tags = await driver.readTags(f)
    assert.ok('replaygain_track_gain' in tags)
  })

  test('processes multiple files (album gain)', async () => {
    if (!(await hasBin(BINS.rsgain)) || !(await hasBin(BINS.metaflac)) || !(await hasBin(BINS.ffmpeg))) return

    const f1 = join(tmpDir, 'rg-multi1.flac')
    const f2 = join(tmpDir, 'rg-multi2.flac')
    await makeSilentFlac(f1)
    await makeSilentFlac(f2)

    await runReplayGain([f1, f2], BINS.rsgain, 'r128')

    const t1 = await driver.readTags(f1)
    const t2 = await driver.readTags(f2)

    // Album gain should be the same for both files in the same album
    assert.equal(t1.replaygain_album_gain, t2.replaygain_album_gain)
  })

  test('throws when rsgain binary does not exist', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'rg-err.flac')
    await makeSilentFlac(f)
    await assert.rejects(() => runReplayGain([f], '/nonexistent/rsgain', 'r128'))
  })
})
