import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentFlac, makeSilentMp3 } from '../../__tests__/helpers.js'
import { checkIntegrity } from '../integrity.js'

const BINS_ARG = { ffprobe: BINS.ffprobe, ffmpeg: BINS.ffmpeg }

let tmpDir: string
before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gt-integrity-test-')) })
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

describe('checkIntegrity — FLAC', () => {
  test('returns ok for a valid FLAC file', async () => {
    if (!(await hasBin(BINS.ffmpeg))) { return }
    const f = join(tmpDir, 'valid.flac')
    await makeSilentFlac(f)
    const result = await checkIntegrity(f, BINS_ARG)
    assert.ok(result.ok, `Expected ok, got: ${result.message}`)
    assert.equal(result.message, undefined)
  })

  test('returns ok=false for a truncated FLAC file', async () => {
    if (!(await hasBin(BINS.ffmpeg))) { return }
    // Create a valid file, then corrupt it by truncating to a few bytes
    const valid = join(tmpDir, 'trunc-source.flac')
    await makeSilentFlac(valid)
    const corrupt = join(tmpDir, 'truncated.flac')
    await writeFile(corrupt, Buffer.alloc(128, 0x00))  // 128 null bytes
    const result = await checkIntegrity(corrupt, BINS_ARG)
    assert.ok(!result.ok, 'Truncated file should fail integrity check')
    assert.ok(result.message, 'Should have an error message')
  })
})

describe('checkIntegrity — MP3', () => {
  test('returns ok for a valid MP3 file', async () => {
    if (!(await hasBin(BINS.ffmpeg)) || !(await hasBin(BINS.ffprobe))) { return }
    const f = join(tmpDir, 'valid.mp3')
    await makeSilentMp3(f)
    const result = await checkIntegrity(f, BINS_ARG)
    assert.ok(result.ok, `Expected ok, got: ${result.message}`)
  })

  test('returns ok=false for a file containing random bytes', async () => {
    if (!(await hasBin(BINS.ffprobe))) { return }
    const corrupt = join(tmpDir, 'garbage.mp3')
    await writeFile(corrupt, Buffer.alloc(512, 0xAB))
    const result = await checkIntegrity(corrupt, BINS_ARG)
    assert.ok(!result.ok, 'Garbage file should fail integrity check')
  })
})

describe('checkIntegrity — missing binary', () => {
  test('returns ok=false with descriptive message when ffmpeg not found', async () => {
    if (!(await hasBin(BINS.ffmpeg))) { return }
    const f = join(tmpDir, 'no-binary.flac')
    await makeSilentFlac(f)
    const result = await checkIntegrity(f, { ffprobe: '/nonexistent/ffprobe', ffmpeg: '/nonexistent/ffmpeg' })
    assert.ok(!result.ok)
    assert.ok(result.message?.toLowerCase().includes('ffmpeg') || result.message?.includes('not found'),
      `Expected binary-not-found message, got: ${result.message}`)
  })
})
