import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINS, hasBin, makeSilentFlac, makeSilentMp3 } from './helpers.js'
import { generateFingerprint, generateFingerprintsBatch } from '../fingerprint.js'

// fpcalc requires >7 seconds of audio to produce a non-empty fingerprint.
const FPCALC_MIN_SECS = 10

let tmpDir: string
before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'gt-fp-test-')) })
after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

describe('generateFingerprint', () => {
  test('returns a fingerprint string and duration for a FLAC file', async () => {
    if (!(await hasBin(BINS.fpcalc)) || !(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'fp.flac')
    await makeSilentFlac(f, FPCALC_MIN_SECS)
    const result = await generateFingerprint(f, BINS.fpcalc)
    assert.ok(typeof result.fingerprint === 'string' && result.fingerprint.length > 0,
      'fingerprint should be a non-empty string')
    assert.ok(typeof result.duration === 'number' && result.duration > 0,
      `duration should be > 0, got: ${result.duration}`)
  })

  test('returns a fingerprint for an MP3 file', async () => {
    if (!(await hasBin(BINS.fpcalc)) || !(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'fp.mp3')
    await makeSilentMp3(f, FPCALC_MIN_SECS)
    const result = await generateFingerprint(f, BINS.fpcalc)
    assert.ok(result.fingerprint.length > 0)
    assert.ok(result.duration > 0)
  })

  test('two identical source files produce the same fingerprint', async () => {
    if (!(await hasBin(BINS.fpcalc)) || !(await hasBin(BINS.ffmpeg))) return
    const f1 = join(tmpDir, 'same1.flac')
    const f2 = join(tmpDir, 'same2.flac')
    // Both are 440Hz sine, same duration → same audio content
    await makeSilentFlac(f1, FPCALC_MIN_SECS)
    await makeSilentFlac(f2, FPCALC_MIN_SECS)
    const r1 = await generateFingerprint(f1, BINS.fpcalc)
    const r2 = await generateFingerprint(f2, BINS.fpcalc)
    assert.equal(r1.fingerprint, r2.fingerprint)
  })

  test('throws when fpcalc binary does not exist', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return
    const f = join(tmpDir, 'err.flac')
    await makeSilentFlac(f, FPCALC_MIN_SECS)
    await assert.rejects(() => generateFingerprint(f, '/nonexistent/fpcalc'))
  })

  test('throws when file does not exist', async () => {
    if (!(await hasBin(BINS.fpcalc))) return
    await assert.rejects(() => generateFingerprint('/nonexistent/track.flac', BINS.fpcalc))
  })
})

describe('generateFingerprintsBatch', () => {
  test('returns a result for each input file', async () => {
    if (!(await hasBin(BINS.fpcalc)) || !(await hasBin(BINS.ffmpeg))) return
    const files = await Promise.all([
      makeSilentFlac(join(tmpDir, 'batch1.flac'), FPCALC_MIN_SECS).then(() => join(tmpDir, 'batch1.flac')),
      makeSilentFlac(join(tmpDir, 'batch2.flac'), FPCALC_MIN_SECS).then(() => join(tmpDir, 'batch2.flac')),
    ])
    const map = await generateFingerprintsBatch(files, BINS.fpcalc)
    assert.equal(map.size, 2)
    for (const f of files) {
      const r = map.get(f)
      assert.ok(!(r instanceof Error), `Expected result, got Error: ${r}`)
      if (!(r instanceof Error)) {
        assert.ok(r.fingerprint.length > 0)
      }
    }
  })

  test('stores an Error for a file that cannot be fingerprinted', async () => {
    if (!(await hasBin(BINS.fpcalc))) return
    const bad = '/nonexistent/missing.flac'
    const map = await generateFingerprintsBatch([bad], BINS.fpcalc)
    const r = map.get(bad)
    assert.ok(r instanceof Error, 'Should have stored an Error for a missing file')
  })
})
