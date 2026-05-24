import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { CliTagDriver } from '../CliTagDriver.js'

const execFileP = promisify(execFile)

// Characters that must survive a FLAC write → read round trip unchanged.
// Each entry has been selected to cover a distinct Unicode code point range
// and a different UTF-8 byte width.
const ROUND_TRIP_CASES: Array<{ key: string; value: string; description: string }> = [
  { key: 'album',       value: 'Introducción a Los Hipsters', description: 'Spanish accented o (U+00F3, 2-byte UTF-8)' },
  { key: 'artist',      value: 'Björk',                      description: 'Icelandic o-umlaut (U+00F6, 2-byte UTF-8)' },
  { key: 'albumartist', value: 'Sigur Rós',                  description: 'Icelandic o-acute (U+00F3, 2-byte UTF-8)' },
  { key: 'title',       value: 'Smells Like Ñoño',           description: 'Spanish n-tilde (U+00D1/00F1, 2-byte UTF-8)' },
  { key: 'genre',       value: 'Café del Mar',               description: 'French e-acute (U+00E9, 2-byte UTF-8)' },
]

async function hasBin(name: string): Promise<boolean> {
  try { await execFileP('which', [name]); return true } catch { return false }
}

async function makeSilentFlac(destPath: string): Promise<void> {
  // 1 second of silence, mono, CD sample rate — smallest valid FLAC
  await execFileP('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-ac', '1', '-ar', '44100',
    destPath,
  ])
}

test('CliTagDriver FLAC: UTF-8 special characters survive write → read round trip', async (t) => {
  if (!(await hasBin('metaflac'))) { t.skip('metaflac not available'); return }
  if (!(await hasBin('ffmpeg')))   { t.skip('ffmpeg not available'); return }

  const tmpFile = join(tmpdir(), `gt-utf8-${Date.now()}.flac`)
  t.after(() => unlink(tmpFile).catch(() => {}))

  await makeSilentFlac(tmpFile)

  const driver = new CliTagDriver()
  const tagsToWrite = Object.fromEntries(ROUND_TRIP_CASES.map(c => [c.key, c.value]))

  await driver.writeTags(tmpFile, tagsToWrite)
  const readBack = await driver.readTags(tmpFile)

  for (const { key, value, description } of ROUND_TRIP_CASES) {
    const got = readBack[key]
    assert.equal(
      got, value,
      `${description}: tag "${key}" corrupted after write→read.\n  Expected: ${JSON.stringify(value)}\n  Got:      ${JSON.stringify(got)}`
    )
  }
})

test('CliTagDriver FLAC: UTF-8 characters are not replaced with # (regression)', async (t) => {
  if (!(await hasBin('metaflac'))) { t.skip('metaflac not available'); return }
  if (!(await hasBin('ffmpeg')))   { t.skip('ffmpeg not available'); return }

  const tmpFile = join(tmpdir(), `gt-utf8-hash-${Date.now()}.flac`)
  t.after(() => unlink(tmpFile).catch(() => {}))

  await makeSilentFlac(tmpFile)

  const driver = new CliTagDriver()
  await driver.writeTags(tmpFile, { album: 'Introducción a Los Hipsters' })
  const readBack = await driver.readTags(tmpFile)

  // Exact value must survive
  assert.equal(readBack.album, 'Introducción a Los Hipsters')

  // Explicitly assert no # substitution pattern (each non-ASCII byte becoming #)
  assert.ok(
    !String(readBack.album ?? '').includes('#'),
    `Tag value contains "#" — non-ASCII bytes are being corrupted: ${JSON.stringify(readBack.album)}`
  )
})

test('CliTagDriver FLAC: batch readTagsBatch preserves UTF-8', async (t) => {
  if (!(await hasBin('metaflac'))) { t.skip('metaflac not available'); return }
  if (!(await hasBin('ffmpeg')))   { t.skip('ffmpeg not available'); return }

  const dir = tmpdir()
  const file1 = join(dir, `gt-utf8-batch1-${Date.now()}.flac`)
  const file2 = join(dir, `gt-utf8-batch2-${Date.now()}.flac`)
  t.after(async () => {
    await Promise.all([unlink(file1).catch(() => {}), unlink(file2).catch(() => {})])
  })

  await Promise.all([makeSilentFlac(file1), makeSilentFlac(file2)])

  const driver = new CliTagDriver()
  await driver.writeTags(file1, { album: 'Introducción a Los Hipsters', title: 'Track Uno' })
  await driver.writeTags(file2, { album: 'Sigur Rós - Ágætis byrjun', title: 'Svefn-g-englar' })

  const batch = await driver.readTagsBatch([file1, file2])

  assert.equal(batch.get(file1)?.album, 'Introducción a Los Hipsters',
    `batch file1 album corrupted: ${JSON.stringify(batch.get(file1)?.album)}`)
  assert.equal(batch.get(file2)?.album, 'Sigur Rós - Ágætis byrjun',
    `batch file2 album corrupted: ${JSON.stringify(batch.get(file2)?.album)}`)
})
