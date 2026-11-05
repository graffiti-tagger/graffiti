import path from 'path'
import { randomUUID } from 'crypto'
import type { Config } from './config.js'
import { processFiles, type ProcessEvent } from './pipeline/process.js'
import { runReplayGain } from './pipeline/replaygain.js'
import { promoteFiles } from './pipeline/promote.js'

export type BatchStage = 'queued' | 'processing' | 'replaygain' | 'promoting' | 'done' | 'error'

export interface BatchJob {
  id: string
  stage: BatchStage
  total: number
  processed: number
  ready: number
  needsReview: string[]
  failed: Array<{ path: string; error: string }>
  replaygainDone: number
  promoted: number
  startedAt: number
  finishedAt: number | null
  error?: string
}

const jobs = new Map<string, BatchJob>()

export const listBatchJobs = () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
export const getBatchJob = (id: string) => jobs.get(id)
export const snapshotJob = (job: BatchJob): BatchJob => ({ ...job, needsReview: [...job.needsReview], failed: [...job.failed] })

export function dismissBatchJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job || (job.stage !== 'done' && job.stage !== 'error')) return false
  return jobs.delete(id)
}

// Runs detached from the HTTP request, so closing the browser or dialog never interrupts it.
// Tracks needing human review are left in the inbox; everything else is scanned and promoted.
export function startBatchJob(
  paths: string[],
  config: Config,
  opts: { replaygain: boolean; promote: boolean },
): BatchJob {
  const job: BatchJob = {
    id: randomUUID(), stage: 'queued', total: paths.length, processed: 0, ready: 0,
    needsReview: [], failed: [], replaygainDone: 0, promoted: 0, startedAt: Date.now(), finishedAt: null,
  }
  jobs.set(job.id, job)
  void run(job, paths, config, opts)
  return job
}

async function run(job: BatchJob, paths: string[], config: Config, opts: { replaygain: boolean; promote: boolean }) {
  const ready: string[] = []
  try {
    job.stage = 'processing'
    const onEvent = (e: ProcessEvent) => {
      if (!('phase' in e) || !e.path) return
      if (e.phase === 'done') { job.processed++; job.ready++; ready.push(e.path) }
      else if (e.phase === 'needs-review') { job.processed++; job.needsReview.push(e.path) }
      else if (e.phase === 'error') { job.processed++; job.failed.push({ path: e.path, error: e.error ?? 'processing failed' }) }
    }
    await processFiles(paths, { ...config, autoProcess: true }, onEvent)

    let toPromote = ready
    if (opts.replaygain && ready.length) {
      job.stage = 'replaygain'
      // Scan per album folder so album gain is computed over the whole album
      const byDir = new Map<string, string[]>()
      for (const p of ready) {
        const dir = path.dirname(p)
        byDir.set(dir, [...(byDir.get(dir) ?? []), p])
      }
      toPromote = []
      for (const group of byDir.values()) {
        try {
          await runReplayGain(group, config.bins.rsgain, config.replaygainStandard)
          job.replaygainDone += group.length
          toPromote.push(...group)
        } catch (err) {
          for (const p of group) job.failed.push({ path: p, error: `ReplayGain: ${(err as Error).message}` })
        }
      }
    }

    if (opts.promote && toPromote.length) {
      job.stage = 'promoting'
      const { promoted, errors } = await promoteFiles(toPromote, config)
      job.promoted = promoted.length
      job.failed.push(...errors)
    }
    job.stage = 'done'
  } catch (err) {
    job.stage = 'error'
    job.error = (err as Error).message
  } finally {
    job.finishedAt = Date.now()
  }
}
