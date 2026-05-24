import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileP = promisify(execFile)

export interface AudioInfo {
  codec: string
  sampleRate: number
  bitDepth: number | null
  channels: number
  duration: number
  bitrate: number | null
}

export interface AudioFlag {
  id: string
  message: string
}

export interface AudioInfoResult {
  info: AudioInfo
  flags: AudioFlag[]
}

export async function getAudioInfo(
  filePath: string,
  ffprobeBin: string
): Promise<AudioInfoResult> {
  let stdout: string
  try {
    ;({ stdout } = await execFileP(ffprobeBin, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { maxBuffer: 4 * 1024 * 1024 }))
  } catch (err) {
    throw new Error(`Failed to probe audio file: ${(err as Error).message}`)
  }

  let data: {
    streams: Array<{
      codec_type: string
      codec_name: string
      sample_rate?: string
      bits_per_sample?: number
      bits_per_raw_sample?: number | string
      channels?: number
    }>
    format: {
      duration?: string
      bit_rate?: string
    }
  }
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new Error('Failed to parse ffprobe output: invalid JSON')
  }

  const stream = data.streams?.find(s => s.codec_type === 'audio')
  if (!stream) throw new Error('No audio stream found')

  // ffprobe reports bits_per_sample=0 for FLAC; the real value is in bits_per_raw_sample
  const bitDepth = (() => {
    const raw = Number(stream.bits_per_raw_sample ?? 0)
    if (raw > 0) return raw
    const bps = Number(stream.bits_per_sample ?? 0)
    return bps > 0 ? bps : null
  })()

  const info: AudioInfo = {
    codec: stream.codec_name,
    sampleRate: parseInt(stream.sample_rate ?? '0', 10),
    bitDepth,
    channels: stream.channels ?? 0,
    duration: parseFloat(data.format.duration ?? '0'),
    bitrate: data.format.bit_rate ? parseInt(data.format.bit_rate, 10) : null,
  }

  const flags: AudioFlag[] = []
  const ext = path.extname(filePath).slice(1).toLowerCase()

  if (['mp3', 'ogg', 'aac'].includes(ext) && info.bitrate !== null && info.bitrate < 192_000) {
    flags.push({ id: 'low_bitrate', message: `Low bitrate: ${Math.round(info.bitrate / 1000)} kbps` })
  }
  if (ext === 'm4a' && info.bitrate !== null && info.bitrate < 256_000) {
    flags.push({ id: 'low_bitrate', message: `Low bitrate: ${Math.round(info.bitrate / 1000)} kbps` })
  }
  if (ext === 'flac') {
    if (info.bitDepth !== null && info.bitDepth < 16) {
      flags.push({ id: 'unusual_encoding', message: `Unusual bit depth: ${info.bitDepth}-bit` })
    }
    if (info.sampleRate > 0 && info.sampleRate < 44100) {
      flags.push({ id: 'unusual_encoding', message: `Unusual sample rate: ${info.sampleRate} Hz` })
    }
  }

  return { info, flags }
}

// Check for fake lossless: highpass at 16 kHz and measure residual volume.
// An authentic lossless file will have audible content above 16 kHz;
// a FLAC transcoded from a 128–192 kbps MP3 typically won't.
export async function checkFakeLossless(
  filePath: string,
  ffmpegBin: string
): Promise<{ suspicious: boolean; message?: string }> {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (ext !== 'flac') return { suspicious: false }

  try {
    const { stderr } = await execFileP(ffmpegBin, [
      '-i', filePath,
      '-af', 'highpass=f=16000,volumedetect',
      '-vn',
      '-f', 'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ], { maxBuffer: 4 * 1024 * 1024 })

    const match = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/)
    if (match) {
      const maxDb = parseFloat(match[1])
      if (maxDb < -40) {
        return {
          suspicious: true,
          message: `No high-freq content above 16 kHz (max ${maxDb.toFixed(0)} dB) - possibly transcoded from lossy`,
        }
      }
    }
    return { suspicious: false }
  } catch {
    // Don't block processing if the check itself fails
    return { suspicious: false }
  }
}
