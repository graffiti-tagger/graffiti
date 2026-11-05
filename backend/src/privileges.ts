import fs from 'fs'

function parseId(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

// Honours PUID/PGID (and optional UMASK): chowns the app's own dirs, then drops root.
export function applyPuidPgid(env: NodeJS.ProcessEnv = process.env): void {
  const umask = env.UMASK?.trim()
  if (umask && /^[0-7]{3,4}$/.test(umask)) process.umask(parseInt(umask, 8))

  const uid = parseId(env.PUID)
  const gid = parseId(env.PGID) ?? uid
  if (uid === null || typeof process.getuid !== 'function' || process.getuid() !== 0) return

  for (const dir of [env.GT_CONFIG_DIR, env.GT_DATA_DIR]) {
    if (!dir) continue
    try {
      fs.mkdirSync(dir, { recursive: true })
      chownTree(dir, uid, gid ?? uid)
    } catch (e) {
      console.warn(`PUID/PGID: could not chown ${dir}: ${(e as Error).message}`)
    }
  }
  if (gid !== null) { process.setgroups?.([gid]); process.setgid?.(gid) }
  process.setuid?.(uid)
}

function chownTree(p: string, uid: number, gid: number): void {
  fs.lchownSync(p, uid, gid)
  if (!fs.lstatSync(p).isDirectory()) return
  for (const name of fs.readdirSync(p)) chownTree(`${p}/${name}`, uid, gid)
}

// Gives a moved/copied file (and any directories created for it) the configured PUID/PGID
// ownership and umask-derived mode, since a rename keeps the source's owner and mode.
export function fixOwnership(filePath: string, createdDirRoot?: string, env: NodeJS.ProcessEnv = process.env): void {
  const uid = parseId(env.PUID)
  const gid = parseId(env.PGID) ?? uid
  const umask = env.UMASK?.trim()
  const mask = umask && /^[0-7]{3,4}$/.test(umask) ? parseInt(umask, 8) : process.umask()
  const targets: Array<{ p: string; mode: number }> = [{ p: filePath, mode: 0o666 & ~mask }]
  if (createdDirRoot) {
    let d = filePath.substring(0, filePath.lastIndexOf('/'))
    while (d.startsWith(createdDirRoot) && d.length >= createdDirRoot.length) {
      targets.push({ p: d, mode: 0o777 & ~mask })
      if (d === createdDirRoot) break
      d = d.substring(0, d.lastIndexOf('/'))
    }
  }
  for (const { p, mode } of targets) {
    try { if (uid !== null) fs.chownSync(p, uid, gid ?? uid) } catch { /* not permitted */ }
    try { fs.chmodSync(p, mode) } catch { /* not permitted */ }
  }
}
