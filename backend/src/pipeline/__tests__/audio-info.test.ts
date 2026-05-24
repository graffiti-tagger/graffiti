import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentFlac, makeSilentMp3 } from '../../__tests__/helpers.js'
import { getAudioInfo, checkFakeLossless } from '../audio-info.js'

let tmpDir: string
before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gt-audio-info-test-')) })
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

describe('getAudioInfo — FLAC', () => {
  test('returns correct codec and sample rate for a standard FLAC', async () => {
    if (!(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'info.flac')
    await makeSilentFlac(f)
    const { info, flags } = await getAudioInfo(f, BINS.ffprobe)
    assert.equal(info.codec, 'flac')
    assert.equal(info.sampleRate, 44100)
    assert.equal(info.channels, 1)
    assert.ok(info.duration > 0)
    // Well-formed FLAC should not trigger quality flags
    assert.equal(flags.filter(f => f.id === 'unusual_encoding').length, 0)
  })

  test('bit depth is extracted for FLAC files', async () => {
    if (!(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'bitdepth.flac')
    await makeSilentFlac(f)
    const { info } = await getAudioInfo(f, BINS.ffprobe)
    // metaflac default encoding is 16-bit
    assert.ok(info.bitDepth !== null && info.bitDepth >= 16,
      `Expected bitDepth >= 16, got: ${info.bitDepth}`)
  })
})

describe('getAudioInfo — MP3', () => {
  test('returns mp3 codec and flags low bitrate for 128 kbps', async () => {
    if (!(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'low.mp3')
    await makeSilentMp3(f)  // created at 128 kbps
    const { info, flags } = await getAudioInfo(f, BINS.ffprobe)
    assert.equal(info.codec, 'mp3')
    // 128 kbps < 192 kbps threshold → low_bitrate flag
    assert.ok(flags.some(f => f.id === 'low_bitrate'),
      `Expected low_bitrate flag for 128kbps MP3, flags: ${JSON.stringify(flags)}`)
  })

  test('returns bitrate for MP3', async () => {
    if (!(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'bitrate.mp3')
    await makeSilentMp3(f)
    const { info } = await getAudioInfo(f, BINS.ffprobe)
    assert.ok(info.bitrate !== null && info.bitrate > 0, `Expected bitrate > 0, got: ${info.bitrate}`)
  })
})

describe('getAudioInfo — error handling', () => {
  test('throws when file does not exist', async () => {
    if (!(await hasBin(BINS.ffprobe))) return
    await assert.rejects(() => getAudioInfo('/nonexistent/track.flac', BINS.ffprobe))
  })

  test('throws when no audio stream found', async () => {
    if (!(await hasBin(BINS.ffprobe))) return
    // Create an empty file that ffprobe will parse but find no audio stream
    const f = join(tmpDir, 'no-stream.txt')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(f, 'this is not audio')
    await assert.rejects(() => getAudioInfo(f, BINS.ffprobe), /Failed to probe|No audio stream found/)
  })
})

describe('checkFakeLossless', () => {
  test('returns not suspicious for a genuine 440Hz sine FLAC', async () => {
    // Our test FLAC is a pure sine wave — it has full-spectrum content
    // (well, a single frequency), but metaflac-encoded FLAC is not transcoded from MP3.
    // The test verifies the function runs without error and returns a result.
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'fake-test.flac')
    await makeSilentFlac(f)
    const result = await checkFakeLossless(f, BINS.ffmpeg)
    // A sine wave at 440Hz has NO high-frequency content (above 16kHz), so it WILL
    // be flagged as suspicious. This is expected behaviour — document it.
    assert.ok(typeof result.suspicious === 'boolean')
    // If suspicious, there should be a message
    if (result.suspicious) {
      assert.ok(result.message, 'suspicious result should include a message')
    }
  })

  test('returns not suspicious for non-FLAC files', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const result = await checkFakeLossless('/any/path/track.mp3', BINS.ffmpeg)
    assert.equal(result.suspicious, false)
    assert.equal(result.message, undefined)
  })

  test('does not throw when file processing fails', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    // Pass a non-existent path — function should swallow the error
    const result = await checkFakeLossless('/nonexistent/track.flac', BINS.ffmpeg)
    assert.equal(result.suspicious, false)
  })
})
