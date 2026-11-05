import fs from 'fs/promises'
import path from 'path'
import type { Config } from './config.js'

export const WATCH_INTERVAL_MS = 15_000

export function intervalMsFor(cfg: Pick<Config, 'watchIntervalSec'>): number {
  const sec = Number(cfg.watchIntervalSec)
  if (!Number.isFinite(sec) || sec <= 0) return WATCH_INTERVAL_MS
  return Math.min(3600, Math.max(5, sec)) * 1000
}
const AUDIO_EXTS = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff'])

async function walkAudio(dir: string, out: Map<string, string> = new Map()): Promise<Map<string, string>> {
  let entries: import('fs').Dirent[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walkAudio(full, out)
    else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      try {
        const st = await fs.stat(full)
        out.set(full, `${st.size}:${st.mtimeMs}`)
      } catch { /* vanished */ }
    }
  }
  return out
}

// Polls the inbox recursively. A file is handed to `process` once, after its
// size/mtime is unchanged between two polls (i.e. the copy/download finished).
// Polling is used instead of fs.watch so nested folders and Docker/network mounts work.
export function startInboxWatcher(
  getConfig: () => Promise<Config>,
  process: (paths: string[], cfg: Config) => Promise<unknown>,
  warn: (msg: string, err: string) => void,
): () => void {
  const pending = new Map<string, string>() // path -> signature last seen
  const handled = new Map<string, string>()  // path -> signature already processed

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    let delay = WATCH_INTERVAL_MS
    try {
      const cfg = await getConfig()
      delay = intervalMsFor(cfg)
      if (!cfg.watchFolders || !cfg.inboxPath) { pending.clear(); return }
      const current = await walkAudio(cfg.inboxPath)

      for (const p of [...handled.keys()]) if (!current.has(p)) handled.delete(p)
      for (const p of [...pending.keys()]) if (!current.has(p)) pending.delete(p)

      const ready: string[] = []
      for (const [p, sig] of current) {
        if (handled.get(p) === sig) continue
        if (pending.get(p) === sig) ready.push(p)
        else pending.set(p, sig)
      }
      if (ready.length === 0) return
      for (const p of ready) { handled.set(p, current.get(p)!); pending.delete(p) }
      await process(ready, cfg)
    } catch (e) {
      warn('inbox-watch: processing failed', (e as Error).message)
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, delay)
        timer.unref?.()
      }
    }
  }
  timer = setTimeout(tick, 0)
  timer.unref?.()
  return () => { stopped = true; clearTimeout(timer) }
}
