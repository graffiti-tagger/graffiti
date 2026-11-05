import fs from 'fs/promises'
import path from 'path'
import type { Config } from '../config.js'
import { driverFor } from '../drivers/index.js'
import { getDb, removeTracksByPaths } from '../db.js'
import { rescanFile } from '../scanner.js'

function applyTemplate(template: string, tags: Record<string, string | string[]>, ext: string): string {
  const get = (k: string) => {
    const v = tags[k]
    const s = Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
    return String(s).trim()
  }
  return template
    .replace(/%extension%/g, ext)
    .replace(/%(\w+)%/g, (_, key) => get(key) || 'Unknown')
}

function sanitizePart(part: string): string {
  return part.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').trim() || '_'
}

export async function promoteFiles(
  filePaths: string[],
  config: Config,
): Promise<{ promoted: string[]; errors: Array<{ path: string; error: string }> }> {
  const promoted: string[] = []
  const errors: Array<{ path: string; error: string }> = []

  for (const filePath of filePaths) {
    try {
      const driver = driverFor(filePath)
      const tags = await driver.readTags(filePath)
      const ext = path.extname(filePath).slice(1).toLowerCase()
      const relPath = applyTemplate(config.pathTemplate, tags as Record<string, string | string[]>, config.lowercaseExtension ? ext : ext.toUpperCase())
      const parts = relPath.split('/').map(sanitizePart)
      const destPath = path.join(config.libraryPath, ...parts)
      await fs.mkdir(path.dirname(destPath), { recursive: true })
      try {
        await fs.rename(filePath, destPath)
      } catch (err: unknown) {
        // Cross-device move: copy then delete
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          await fs.copyFile(filePath, destPath)
          await fs.unlink(filePath)
        } else {
          throw err
        }
      }
      await rescanFile(destPath, driver)
      removeTracksByPaths(getDb(), [filePath])
      promoted.push(destPath)
    } catch (err: unknown) {
      errors.push({ path: filePath, error: (err as Error).message })
    }
  }

  // Remove empty inbox subdirectories left behind after promotion
  if (config.inboxPath && promoted.length > 0) {
    const dirsToTry = new Set<string>()
    for (const filePath of filePaths) {
      let dir = path.dirname(filePath)
      while (dir !== config.inboxPath && dir.startsWith(config.inboxPath + path.sep)) {
        dirsToTry.add(dir)
        dir = path.dirname(dir)
      }
    }
    // Deepest first so children are removed before parents
    for (const dir of [...dirsToTry].sort((a, b) => b.length - a.length)) {
      try { await fs.rmdir(dir) } catch { /* non-empty or already gone — skip */ }
    }
  }

  return { promoted, errors }
}
