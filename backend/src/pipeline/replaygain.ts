import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

export async function runReplayGain(
  filePaths: string[],
  rsgainBin: string,
  standard: 'r128' | 'legacy'
): Promise<void> {
  if (filePaths.length === 0) return

  // -s i = scan and write ReplayGain 2.0 tags
  // -a   = calculate album gain
  const args = ['custom', '-a', '-s', 'i']
  // R128 (EBU) targets -23 LUFS; default is -18 LUFS (ReplayGain 2.0 / legacy)
  if (standard === 'r128') args.push('-l', '-23')
  args.push(...filePaths)

  await execFileP(rsgainBin, args, { maxBuffer: 16 * 1024 * 1024 })
}
