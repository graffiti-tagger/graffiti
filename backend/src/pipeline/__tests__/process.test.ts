// Set DB to a temp dir before any imports touch the singleton
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { BINS, hasBin, makeSilentFlac, jsonResponse } from '../../__tests__/helpers.js'

const dbDir = join(tmpdir(), `gt-process-db-${Date.now()}`)
mkdirSync(dbDir, { recursive: true })
process.env.GT_DATA_DIR = dbDir

import { getDb } from '../../db.js'
import { processFiles } from '../process.js'
import type { ProcessEvent, FileResult } from '../process.js'

// Prime the DB singleton
getDb()

// Mock fetch so no real network calls are made during processFiles
let originalFetch: typeof globalThis.fetch
const fetchLog: string[] = []

before(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url: RequestInfo) => {
    const u = String(url)
    fetchLog.push(u)

    if (u.includes('api.acoustid.org/v2/lookup')) {
      return jsonResponse({ status: 'ok', results: [] })  // no AcoustID match
    }
    if (u.includes('musicbrainz.org')) {
      return jsonResponse({
        id: 'test-rec',
        title: 'Test',
        length: 30000,
        'artist-credit': [{ artist: { id: 'art-1', name: 'Test Artist' } }],
        releases: [],
      })
    }
    return jsonResponse({})
  }
})

after(async () => {
  globalThis.fetch = originalFetch
  await rm(dbDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDb().prepare('DELETE FROM tracks').run()
  fetchLog.length = 0
})

function collectEvents(events: ProcessEvent[]): {
  phases: Map<string, string>
  steps: Map<string, Map<string, string>>
} {
  const phases = new Map<string, string>()
  const steps = new Map<string, Map<string, string>>()

  for (const ev of events) {
    if ('phase' in ev) {
      phases.set(ev.path, ev.phase)
    } else if ('step' in ev) {
      if (!steps.has(ev.path)) steps.set(ev.path, new Map())
      steps.get(ev.path)!.set(ev.step, ev.status)
    }
  }
  return { phases, steps }
}

const testConfig = {
  libraryPath: '/tmp/lib',
  inboxPath: '/tmp/inbox',
  backupPath: '/tmp/trash',
  watchFolders: false,
  pathTemplate: '%albumartist%/%album%/%tracknumber% - %title%.%extension%',
  sanitizeChars: true,
  lowercaseExtension: true,
  padTrackNumber: false,
  musicbrainz: { server: 'musicbrainz.org', port: 443, username: '', password: '', acoustidUserKey: '', submitFingerprints: false },
  bins: {
    metaflac: BINS.metaflac, vorbiscomment: 'vorbiscomment',
    AtomicParsley: 'AtomicParsley', fpcalc: BINS.fpcalc, rsgain: BINS.rsgain,
    ffprobe: BINS.ffprobe, ffmpeg: BINS.ffmpeg,
  },
  batchFlac: true,
  autoProcess: true,
  replaygainStandard: 'r128' as const,
  acoustidConfidenceThreshold: 0.85,
  fakeLosslessDetection: false,  // disable to speed up tests
}

describe('processFiles — empty list', () => {
  test('resolves immediately with no events emitted', async () => {
    const events: ProcessEvent[] = []
    await processFiles([], testConfig, e => events.push(e))
    assert.equal(events.length, 0)
  })
})

describe('processFiles — single valid FLAC file', () => {
  test('emits running → step events → phase event for each file', async () => {
    if (!(await hasBin(BINS.ffmpeg)) || !(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.fpcalc))) return

    const dir = mkdtempSync(join(tmpdir(), 'gt-proc-'))
    const f = join(dir, 'proc.flac')
    try {
      await makeSilentFlac(f)
      const events: ProcessEvent[] = []
      await processFiles([f], testConfig, e => events.push(e))

      const { phases, steps } = collectEvents(events)

      // Should have a final phase for this file
      assert.ok(phases.has(f), `No phase event for ${f}. Events: ${JSON.stringify(events)}`)

      // Expected steps (in order they should have been attempted)
      const fileSteps = steps.get(f)
      assert.ok(fileSteps?.has('integrity'), 'Should attempt integrity check')
      assert.ok(fileSteps?.has('audio'), 'Should attempt audio info')
      assert.ok(fileSteps?.has('fingerprint'), 'Should attempt fingerprinting')
      assert.ok(fileSteps?.has('duplicate'), 'Should check for duplicates')
      assert.ok(fileSteps?.has('tags'), 'Should check tag quality')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('phase is done or needs-review (not error) for a valid file', async () => {
    if (!(await hasBin(BINS.ffmpeg)) || !(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.fpcalc))) return

    const dir = mkdtempSync(join(tmpdir(), 'gt-proc2-'))
    const f = join(dir, 'valid.flac')
    try {
      await makeSilentFlac(f)
      const events: ProcessEvent[] = []
      await processFiles([f], testConfig, e => events.push(e))
      const { phases } = collectEvents(events)
      const phase = phases.get(f)
      assert.ok(['done', 'needs-review'].includes(phase ?? ''),
        `Expected done or needs-review, got: ${phase}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('processFiles — invalid / corrupt file', () => {
  test('emits error phase for a non-audio file', async () => {
    if (!(await hasBin(BINS.ffmpeg))) return

    const dir = mkdtempSync(join(tmpdir(), 'gt-proc-err-'))
    const f = join(dir, 'garbage.flac')
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(f, Buffer.alloc(128, 0x00))

      const events: ProcessEvent[] = []
      await processFiles([f], testConfig, e => events.push(e))

      const { phases } = collectEvents(events)
      assert.equal(phases.get(f), 'error', 'Corrupt file should result in error phase')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('processFiles — concurrency', () => {
  test('processes multiple files without losing any', async () => {
    if (!(await hasBin(BINS.ffmpeg)) || !(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.fpcalc))) return

    const N = 7  // more than CONCURRENCY (5)
    const dir = mkdtempSync(join(tmpdir(), 'gt-proc-conc-'))
    const files: string[] = []
    try {
      for (let i = 0; i < N; i++) {
        const f = join(dir, `track${i}.flac`)
        await makeSilentFlac(f)
        files.push(f)
      }

      const events: ProcessEvent[] = []
      await processFiles(files, testConfig, e => events.push(e))

      const { phases } = collectEvents(events)
      // Every file must have received a phase event
      for (const f of files) {
        assert.ok(phases.has(f), `Missing phase event for ${f}`)
      }
      assert.equal(phases.size, N)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('one failing file does not block other files from completing', async () => {
    if (!(await hasBin(BINS.ffmpeg)) || !(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.fpcalc))) return

    const dir = mkdtempSync(join(tmpdir(), 'gt-proc-fail-'))
    const good = join(dir, 'good.flac')
    const bad  = join(dir, 'bad.flac')
    try {
      await makeSilentFlac(good)
      const { writeFile } = await import('node:fs/promises')
      await writeFile(bad, Buffer.alloc(64, 0x00))

      const events: ProcessEvent[] = []
      await processFiles([good, bad], testConfig, e => events.push(e))

      const { phases } = collectEvents(events)
      assert.ok(['done', 'needs-review'].includes(phases.get(good) ?? ''),
        `Good file should complete; got: ${phases.get(good)}`)
      assert.equal(phases.get(bad), 'error', 'Bad file should error')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('processFiles — result shape', () => {
  test('result attached to phase event has correct fields', async () => {
    if (!(await hasBin(BINS.ffmpeg)) || !(await hasBin(BINS.ffprobe)) || !(await hasBin(BINS.fpcalc))) return

    const dir = mkdtempSync(join(tmpdir(), 'gt-proc-res-'))
    const f = join(dir, 'result.flac')
    try {
      await makeSilentFlac(f)
      const events: ProcessEvent[] = []
      await processFiles([f], testConfig, e => events.push(e))

      const phaseEv = events.find(e => 'phase' in e && e.path === f && e.phase !== 'running') as
        { path: string; phase: string; result?: FileResult } | undefined

      assert.ok(phaseEv, 'Should have a final phase event')
      if (phaseEv.phase !== 'error') {
        const r = phaseEv.result!
        assert.ok(r, 'Phase event should carry result')
        assert.ok(Array.isArray(r.acoustidMatches))
        assert.ok(typeof r.isDuplicate === 'boolean')
        assert.ok(typeof r.artPresent === 'boolean')
        assert.ok(Array.isArray(r.tagIssues))
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
