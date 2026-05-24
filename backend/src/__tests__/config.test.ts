import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig } from '../config.js'
import type { Config } from '../config.js'

let tmpDir: string
const origConfigDir = process.env.GT_CONFIG_DIR

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gt-config-test-'))
  process.env.GT_CONFIG_DIR = tmpDir
})

after(async () => {
  if (origConfigDir === undefined) delete process.env.GT_CONFIG_DIR
  else process.env.GT_CONFIG_DIR = origConfigDir
  await rm(tmpDir, { recursive: true, force: true })
})

describe('config — readConfig', () => {
  test('returns defaults when no config file exists', async () => {
    // tmpDir is empty — no config.json
    const cfg = await readConfig()
    assert.ok(cfg.libraryPath, 'libraryPath should have a default')
    assert.ok(cfg.inboxPath, 'inboxPath should have a default')
    assert.ok(cfg.bins.metaflac, 'bins.metaflac should have a default')
    assert.equal(cfg.autoProcess, true)
    assert.equal(cfg.batchFlac, true)
    assert.equal(cfg.replaygainStandard, 'r128')
    assert.equal(cfg.acoustidConfidenceThreshold, 0.85)
  })

  test('merges stored values over defaults', async () => {
    const partial = { libraryPath: '/custom/music', batchFlac: false }
    await writeConfig({ ...await readConfig(), ...partial } as Config)
    const cfg = await readConfig()
    assert.equal(cfg.libraryPath, '/custom/music')
    assert.equal(cfg.batchFlac, false)
    // defaults for unset keys are preserved
    assert.equal(cfg.autoProcess, true)
  })
})

describe('config — writeConfig / round-trip', () => {
  test('writes valid JSON to disk', async () => {
    const cfg = await readConfig()
    cfg.libraryPath = '/round/trip'
    cfg.musicbrainz.username = 'testuser'
    await writeConfig(cfg)

    const raw = JSON.parse(await readFile(join(tmpDir, 'config.json'), 'utf-8'))
    assert.equal(raw.libraryPath, '/round/trip')
    assert.equal(raw.musicbrainz.username, 'testuser')
  })

  test('read after write returns the written values', async () => {
    const cfg = await readConfig()
    cfg.acoustidConfidenceThreshold = 0.7
    cfg.fakeLosslessDetection = false
    await writeConfig(cfg)

    const back = await readConfig()
    assert.equal(back.acoustidConfidenceThreshold, 0.7)
    assert.equal(back.fakeLosslessDetection, false)
  })

  test('writeConfig creates the config directory if it does not exist', async () => {
    const deepDir = join(tmpDir, 'nested', 'deep')
    process.env.GT_CONFIG_DIR = deepDir
    try {
      const cfg = await readConfig()
      await writeConfig(cfg)
      const raw = JSON.parse(await readFile(join(deepDir, 'config.json'), 'utf-8'))
      assert.ok(raw.bins)
    } finally {
      process.env.GT_CONFIG_DIR = tmpDir
    }
  })
})
