import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import os from 'os'
import unzipper from 'unzipper'
import { pipeline } from 'stream/promises'
import type { Readable } from 'stream'

const AUDIO_EXTS = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff'])
const MAX_ZIP_FILES = 500
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export type IngestEvent =
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'extracting'; file: string; n: number; of: number }
  | { phase: 'done'; files: string[] }
  | { phase: 'error'; message: string }

function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let p = path.join(dir, filename)
  let i = 0
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${++i})${ext}`)
  return p
}

function filenameFromHeaders(url: string, contentDisposition: string | null): string {
  if (contentDisposition) {
    const m = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"'\r\n;]+)/i)
    if (m?.[1]) return decodeURIComponent(m[1].trim())
  }
  try {
    const base = decodeURIComponent(path.basename(new URL(url).pathname))
    if (base && base !== '/') return base
  } catch { /* ignore */ }
  return 'download'
}

export async function downloadUrlToInbox(
  url: string,
  inboxPath: string,
  emit: (e: IngestEvent) => void
): Promise<string[]> {
  await fsp.mkdir(inboxPath, { recursive: true })

  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch (e: unknown) {
    throw new Error(`Connection failed: ${(e as Error).message}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  if (!res.body) throw new Error('Empty response body')

  const contentType = res.headers.get('content-type') ?? ''
  const total = res.headers.get('content-length') ? parseInt(res.headers.get('content-length')!) : null
  const filename = filenameFromHeaders(url, res.headers.get('content-disposition'))
  const isZip = /\.zip$/i.test(filename) || contentType.includes('zip')
  const suffix = isZip ? '.zip' : (path.extname(filename) || '')
  const tmpFile = path.join(
    os.tmpdir(),
    `gt-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`
  )

  const ws = fs.createWriteStream(tmpFile)
  let downloaded = 0

  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      ws.write(value)
      downloaded += value.length
      emit({ phase: 'downloading', downloaded, total })
    }
    await new Promise<void>((ok, fail) => ws.end((e: Error | null | undefined) => (e ? fail(e) : ok())))

    if (isZip) {
      return await extractZipToInbox(tmpFile, inboxPath, emit)
    } else {
      const ext = path.extname(filename).toLowerCase()
      if (!AUDIO_EXTS.has(ext)) throw new Error(`Unsupported file type: ${ext || '(unknown)'}`)
      const dest = uniquePath(inboxPath, filename)
      await fsp.rename(tmpFile, dest)
      const files = [dest]
      emit({ phase: 'done', files })
      return files
    }
  } catch (e) {
    await fsp.unlink(tmpFile).catch(() => {})
    throw e
  }
}

function folderNameForZip(zipPath: string, audioEntries: unzipper.File[]): string {
  // If every audio entry shares a single top-level directory, use that name —
  // most Bandcamp/scene zips already have Artist - Album (Year)/ at the root.
  const topDirs = new Set(
    audioEntries.map(f => {
      const parts = f.path.replace(/\\/g, '/').split('/')
      return parts.length > 1 ? parts[0] : ''
    })
  )
  if (topDirs.size === 1) {
    const dir = [...topDirs][0]
    if (dir) return dir
  }
  // Fall back to the zip filename without extension
  return path.basename(zipPath, '.zip')
}

export async function extractZipToInbox(
  zipPath: string,
  inboxPath: string,
  emit: (e: IngestEvent) => void
): Promise<string[]> {
  await fsp.mkdir(inboxPath, { recursive: true })

  const directory = await unzipper.Open.file(zipPath)
  const audioEntries = directory.files.filter(f => {
    if (f.type !== 'File') return false
    const name = path.basename(f.path)
    if (name.startsWith('._') || f.path.includes('__MACOSX/')) return false
    return AUDIO_EXTS.has(path.extname(f.path).toLowerCase())
  })

  if (audioEntries.length === 0) throw new Error('No supported audio files found in zip')

  // Determine destination subfolder and make it unique if it already exists
  const folderName = folderNameForZip(zipPath, audioEntries)
  const destDir = uniquePath(inboxPath, folderName)
  await fsp.mkdir(destDir, { recursive: true })

  const added: string[] = []
  let totalExtracted = 0

  for (let i = 0; i < Math.min(audioEntries.length, MAX_ZIP_FILES); i++) {
    const entry = audioEntries[i]
    const filename = path.basename(entry.path)
    emit({ phase: 'extracting', file: filename, n: i + 1, of: audioEntries.length })
    totalExtracted += entry.uncompressedSize
    if (totalExtracted > MAX_EXTRACT_BYTES) throw new Error('Extraction size limit exceeded (2 GB)')
    const dest = uniquePath(destDir, filename)
    await pipeline(entry.stream(), fs.createWriteStream(dest))
    added.push(dest)
  }

  emit({ phase: 'done', files: added })
  return added
}

export async function saveUploadedFile(
  stream: Readable,
  filename: string,
  inboxPath: string
): Promise<string | null> {
  const ext = path.extname(filename).toLowerCase()
  if (!AUDIO_EXTS.has(ext)) return null
  await fsp.mkdir(inboxPath, { recursive: true })
  const dest = uniquePath(inboxPath, filename)
  await pipeline(stream, fs.createWriteStream(dest))
  return dest
}

export async function saveUploadedZip(
  stream: Readable,
  inboxPath: string,
  emit: (e: IngestEvent) => void
): Promise<string[]> {
  const tmpFile = path.join(
    os.tmpdir(),
    `gt-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`
  )
  try {
    await pipeline(stream, fs.createWriteStream(tmpFile))
    return await extractZipToInbox(tmpFile, inboxPath, emit)
  } finally {
    await fsp.unlink(tmpFile).catch(() => {})
  }
}
