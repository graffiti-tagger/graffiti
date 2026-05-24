import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileP = promisify(execFile)

export interface IntegrityResult {
  ok: boolean
  message?: string
}

// Decode all audio frames via ffmpeg - this validates FLAC CRCs and catches
// truncated or bit-corrupted files that ffprobe (header-only) would miss.
async function decodeAllFrames(filePath: string, ffmpegBin: string): Promise<IntegrityResult> {
  const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null'
  try {
    const { stderr } = await execFileP(ffmpegBin, [
      '-v', 'error',
      '-i', filePath,
      '-f', 'null',
      devNull,
    ], { maxBuffer: 4 * 1024 * 1024 })
    if (stderr.trim()) {
      return { ok: false, message: stderr.trim().split('\n')[0] }
    }
    return { ok: true }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stderr?: string }
    if (err.code === 'ENOENT') return { ok: false, message: `ffmpeg not found - check Settings > Backend Tools` }
    const msg = (err.stderr?.trim() || err.message).split('\n')[0]
    return { ok: false, message: msg }
  }
}

export async function checkIntegrity(
  filePath: string,
  bins: { ffprobe: string; ffmpeg: string }
): Promise<IntegrityResult> {
  const ext = path.extname(filePath).slice(1).toLowerCase()

  // FLAC: decode all frames so CRC errors in audio data are caught
  if (ext === 'flac') {
    return decodeAllFrames(filePath, bins.ffmpeg)
  }

  // Everything else: ffprobe confirms the container is parseable
  try {
    const { stderr } = await execFileP(bins.ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1',
      filePath,
    ])
    if (stderr.trim()) {
      return { ok: false, message: stderr.trim().split('\n')[0] }
    }
    return { ok: true }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stderr?: string }
    if (err.code === 'ENOENT') return { ok: false, message: `ffprobe not found - check Settings > Backend Tools` }
    const msg = (err.stderr?.trim() || err.message).split('\n')[0]
    return { ok: false, message: msg }
  }
}
