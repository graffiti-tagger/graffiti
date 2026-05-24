// Compute a 0-100 health score for a track based on which mandatory tags are present.
// The tagSettings map comes from config.tagSettings.
// cover_art is a synthetic key (not a real tag field) — pass hasCoverArt separately.

export function computeHealth(
  tagsJson: string,
  hasCoverArt: boolean | null,
  tagSettings: Record<string, 'mandatory' | 'optional' | 'ignored'>
): number {
  const tags: Record<string, unknown> = JSON.parse(tagsJson || '{}')

  const mandatory = Object.entries(tagSettings)
    .filter(([, v]) => v === 'mandatory')
    .map(([k]) => k)

  if (mandatory.length === 0) return 100

  let present = 0
  for (const key of mandatory) {
    if (key === 'cover_art') {
      if (hasCoverArt === true) present++
    } else {
      // tags_json stores Vorbis comment keys in lowercase; logical keys are also lowercase.
      // Some drivers store uppercase keys, so check both.
      const val = tags[key] ?? tags[key.toUpperCase()]
      if (val !== undefined && val !== null && val !== '') present++
    }
  }

  return Math.round((present / mandatory.length) * 100)
}
