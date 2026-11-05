import { test, expect, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { startInboxWatcher, intervalMsFor } from '../watcher.js'

test('intervalMsFor clamps and defaults', () => {
  expect(intervalMsFor({ watchIntervalSec: 30 })).toBe(30_000)
  expect(intervalMsFor({ watchIntervalSec: 1 })).toBe(5_000)
  expect(intervalMsFor({ watchIntervalSec: 99999 })).toBe(3_600_000)
  expect(intervalMsFor({} as never)).toBe(15_000)
})

test('processes nested inbox files once, honouring configured interval', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gt-inbox-'))
  await fs.mkdir(path.join(dir, 'a', 'b'), { recursive: true })
  const file = path.join(dir, 'a', 'b', 't.flac')
  await fs.writeFile(file, 'x')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const proc = vi.fn(async () => {})
  const cfg = { watchFolders: true, inboxPath: dir, watchIntervalSec: 10 } as never
  const stop = startInboxWatcher(async () => cfg, proc, () => {})
  const step = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r))
  }
  await step(0)
  await step(9_000)
  expect(proc).not.toHaveBeenCalled()
  await step(1_500)
  await step(10_000)
  stop()
  vi.useRealTimers()
  expect(proc).toHaveBeenCalledTimes(1)
  expect((proc.mock.calls[0] as unknown[])[0]).toEqual([file])
  await fs.rm(dir, { recursive: true })
})

test('does nothing when disabled', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const proc = vi.fn(async () => {})
  const stop = startInboxWatcher(async () => ({ watchFolders: false, inboxPath: '/tmp' }) as never, proc, () => {})
  await vi.advanceTimersByTimeAsync(60_000)
  stop()
  vi.useRealTimers()
  expect(proc).not.toHaveBeenCalled()
})
