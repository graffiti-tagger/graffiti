import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

export interface FingerprintResult {
  duration: number
  fingerprint: string
}

export async function generateFingerprint(
  filePath: string,
  fpcalcBin: string
): Promise<FingerprintResult> {
  const { stdout } = await execFileP(fpcalcBin, ['-json', filePath])
  const parsed = JSON.parse(stdout.trim()) as { duration: number; fingerprint: string }
  if (!parsed.fingerprint || !parsed.duration) {
    throw new Error('fpcalc returned unexpected output')
  }
  return { duration: parsed.duration, fingerprint: parsed.fingerprint }
}

export async function generateFingerprintsBatch(
  filePaths: string[],
  fpcalcBin: string
): Promise<Map<string, FingerprintResult | Error>> {
  const results = await Promise.allSettled(
    filePaths.map(p => generateFingerprint(p, fpcalcBin))
  )
  const map = new Map<string, FingerprintResult | Error>()
  for (let i = 0; i < filePaths.length; i++) {
    const r = results[i]
    map.set(filePaths[i], r.status === 'fulfilled' ? r.value : r.reason)
  }
  return map
}
