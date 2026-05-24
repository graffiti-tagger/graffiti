// =============================================================
// Graffiti Tagger — canonical tag schema
//
// Each entry describes one logical tag field. The UI, grid
// column list, path-template placeholders, and (eventually)
// the CLI backend all derive from this single file.
//
// nativeKey: the actual field name written to disk per format
//   vorbis  — used for FLAC and OGG (Vorbis Comments)
//   id3     — used for MP3 (ID3v2.4 frame codes)
//   mp4     — used for M4A/AAC (iTunes atom or ---- freeform)
//
// multi: whether the format natively supports multiple values
//   for this field (e.g. multiple ARTIST tags on one track)
//
// standard: whether this field is part of the format's formal
//   spec vs. just de-facto convention
//
// gridDefault: shown as a column in the grid by default
// placeholder: token used in path/filename templates
// readOnly: computed by the tagger tool, not user-editable
// =============================================================

export const TAGS = [

  // ── Core identity ─────────────────────────────────────────
  {
    key: "title",
    label: "Title",
    group: "core",
    coreField: true,
    gridDefault: true,   // default col #5
    placeholder: "%title%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: true,  id3: true,  mp4: true  },
    nativeKey: { vorbis: "TITLE", id3: "TIT2", mp4: "©nam" },
  },
  {
    key: "artist",
    label: "Artist",
    group: "core",
    coreField: true,
    gridDefault: true,   // default col #2
    placeholder: "%artist%",
    // Vorbis allows multiple ARTIST tags for collaborations
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: true,  id3: true,  mp4: true  },
    nativeKey: { vorbis: "ARTIST", id3: "TPE1", mp4: "©ART" },
  },
  {
    key: "albumartist",
    label: "Album Artist",
    group: "core",
    coreField: true,
    gridDefault: true,   // default col #1
    placeholder: "%albumartist%",
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: true,  mp4: false },
    nativeKey: { vorbis: "ALBUMARTIST", id3: "TPE2", mp4: "aART" },
    notes: "Also written as ALBUM_ARTIST in some Vorbis tools.",
  },
  {
    key: "album",
    label: "Album",
    group: "core",
    coreField: true,
    gridDefault: true,   // default col #3
    placeholder: "%album%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: true,  id3: true,  mp4: true  },
    nativeKey: { vorbis: "ALBUM", id3: "TALB", mp4: "©alb" },
  },
  {
    key: "tracknumber",
    label: "Track #",
    group: "core",
    coreField: true,
    gridDefault: true,   // default col #4
    placeholder: "%tracknumber%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: true,  id3: true,  mp4: true  },
    nativeKey: { vorbis: "TRACKNUMBER", id3: "TRCK", mp4: "trkn" },
    notes: "May be stored as 'n' or 'n/total'. In MP4, trkn is a binary atom holding both values.",
  },
  {
    key: "tracktotal",
    label: "Total Tracks",
    group: "core",
    gridDefault: false,
    placeholder: "%totaltracks%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "TRACKTOTAL", id3: "TRCK", mp4: "trkn" },
    notes: "In ID3 and MP4 this shares the same frame/atom as tracknumber. In Vorbis, stored separately or as 'n/total' in TRACKNUMBER.",
  },
  {
    key: "discnumber",
    label: "Disc #",
    group: "core",
    coreField: true,
    gridDefault: true,
    placeholder: "%discnumber%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: true,  mp4: false },
    nativeKey: { vorbis: "DISCNUMBER", id3: "TPOS", mp4: "disk" },
  },
  {
    key: "disctotal",
    label: "Total Discs",
    group: "core",
    gridDefault: false,
    placeholder: "%disctotal%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "DISCTOTAL", id3: "TPOS", mp4: "disk" },
    notes: "Shares frame/atom with discnumber, same pattern as tracktotal.",
  },
  {
    key: "date",
    label: "Date",
    group: "core",
    coreField: true,
    gridDefault: true,
    placeholder: "%date%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: true,  id3: true,  mp4: true  },
    nativeKey: { vorbis: "DATE", id3: "TDRC", mp4: "©day" },
    notes: "ID3v2.3 used TYER (year only) + TDAT; ID3v2.4 uses TDRC which supports full ISO 8601 dates. Vorbis DATE is the canonical field.",
  },
  {
    key: "genre",
    label: "Genre",
    group: "core",
    coreField: true,
    gridDefault: true,
    placeholder: "%genre%",
    // Vorbis allows multiple; ID3 TCON technically allows multiple via null separation
    multi:    { vorbis: true,  id3: true,  mp4: false },
    standard: { vorbis: false, id3: true,  mp4: false },
    nativeKey: { vorbis: "GENRE", id3: "TCON", mp4: "©gen" },
    notes: "ID3 TCON also has a numeric genre-code system inherited from ID3v1. MP4 has both gnre (numeric) and ©gen (text); prefer ©gen.",
  },

  // ── People ────────────────────────────────────────────────
  {
    key: "composer",
    label: "Composer",
    group: "people",
    gridDefault: false,
    placeholder: "%composer%",
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "COMPOSER", id3: "TCOM", mp4: "©wrt" },
  },
  {
    key: "lyricist",
    label: "Lyricist",
    group: "people",
    gridDefault: false,
    placeholder: "%lyricist%",
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "LYRICIST", id3: "TEXT", mp4: null },
  },
  {
    key: "conductor",
    label: "Conductor",
    group: "people",
    gridDefault: false,
    placeholder: "%conductor%",
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "CONDUCTOR", id3: "TPE3", mp4: "©cond" },
  },
  {
    key: "remixedby",
    label: "Remixed By",
    group: "people",
    gridDefault: false,
    placeholder: "%remixedby%",
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "REMIXEDBY", id3: "TPE4", mp4: null },
  },
  {
    key: "performer",
    label: "Performer",
    group: "people",
    gridDefault: false,
    placeholder: "%performer%",
    // Vorbis: typically "Name (instrument)" repeated per performer
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "PERFORMER", id3: "TMCL", mp4: null },
    notes: "Vorbis convention: 'Vocalist Name (vocals)', one tag per person.",
  },

  // ── Content ───────────────────────────────────────────────
  {
    key: "comment",
    label: "Comment",
    group: "content",
    gridDefault: false,
    placeholder: "%comment%",
    multi:    { vorbis: true,  id3: true,  mp4: false },
    standard: { vorbis: false, id3: true,  mp4: false },
    nativeKey: { vorbis: "COMMENT", id3: "COMM", mp4: "©cmt" },
    notes: "ID3 COMM frames require a language code (typically 'eng') and a short description field.",
  },
  {
    key: "lyrics",
    label: "Lyrics",
    group: "content",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "LYRICS", id3: "USLT", mp4: "©lyr" },
    notes: "Unsynchronised lyrics only. ID3 also has SYLT for time-coded lyrics.",
  },
  {
    key: "bpm",
    label: "BPM",
    group: "content",
    gridDefault: false,
    placeholder: "%bpm%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "BPM", id3: "TBPM", mp4: "tmpo" },
  },
  {
    key: "key",
    label: "Initial Key",
    group: "content",
    gridDefault: false,
    placeholder: "%key%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "INITIALKEY", id3: "TKEY", mp4: "----:com.apple.iTunes:initialkey" },
  },
  {
    key: "grouping",
    label: "Grouping",
    group: "content",
    gridDefault: false,
    placeholder: "%grouping%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "GROUPING", id3: "GRP1", mp4: "©grp" },
  },

  // ── Release info ──────────────────────────────────────────
  {
    key: "label",
    label: "Label",
    group: "release",
    gridDefault: false,
    placeholder: "%label%",
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "LABEL", id3: "TPUB", mp4: "----:com.apple.iTunes:LABEL" },
  },
  {
    key: "catalognumber",
    label: "Catalog Number",
    group: "release",
    gridDefault: false,
    placeholder: "%catalognumber%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "CATALOGNUMBER", id3: "TXXX:CATALOGNUMBER", mp4: "----:com.apple.iTunes:CATALOGNUMBER" },
  },
  {
    key: "isrc",
    label: "ISRC",
    group: "release",
    gridDefault: false,
    placeholder: "%isrc%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "ISRC", id3: "TSRC", mp4: "----:com.apple.iTunes:ISRC" },
  },
  {
    key: "copyright",
    label: "Copyright",
    group: "release",
    gridDefault: false,
    placeholder: "%copyright%",
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "COPYRIGHT", id3: "TCOP", mp4: "cprt" },
  },
  {
    key: "compilation",
    label: "Compilation",
    group: "release",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "COMPILATION", id3: "TCMP", mp4: "cpil" },
    notes: "Boolean 0/1. ID3 TCMP is an iTunes extension; some tools use TXXX:COMPILATION instead.",
  },

  // ── ReplayGain ────────────────────────────────────────────
  {
    key: "rg_track_gain",
    label: "RG Track Gain",
    group: "replaygain",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "REPLAYGAIN_TRACK_GAIN", id3: "TXXX:REPLAYGAIN_TRACK_GAIN", mp4: "----:com.apple.iTunes:REPLAYGAIN_TRACK_GAIN" },
    notes: "Value in dB, e.g. '-7.23 dB'.",
  },
  {
    key: "rg_track_peak",
    label: "RG Track Peak",
    group: "replaygain",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "REPLAYGAIN_TRACK_PEAK", id3: "TXXX:REPLAYGAIN_TRACK_PEAK", mp4: "----:com.apple.iTunes:REPLAYGAIN_TRACK_PEAK" },
  },
  {
    key: "rg_album_gain",
    label: "RG Album Gain",
    group: "replaygain",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "REPLAYGAIN_ALBUM_GAIN", id3: "TXXX:REPLAYGAIN_ALBUM_GAIN", mp4: "----:com.apple.iTunes:REPLAYGAIN_ALBUM_GAIN" },
  },
  {
    key: "rg_album_peak",
    label: "RG Album Peak",
    group: "replaygain",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "REPLAYGAIN_ALBUM_PEAK", id3: "TXXX:REPLAYGAIN_ALBUM_PEAK", mp4: "----:com.apple.iTunes:REPLAYGAIN_ALBUM_PEAK" },
  },

  // ── MusicBrainz IDs ───────────────────────────────────────
  {
    key: "mb_recordingid",
    label: "MB Recording ID",
    group: "musicbrainz",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "MUSICBRAINZ_RECORDINGID", id3: "TXXX:MUSICBRAINZ_RECORDINGID", mp4: "----:com.apple.iTunes:MUSICBRAINZ_RECORDINGID" },
  },
  {
    key: "mb_releaseid",
    label: "MB Release ID",
    group: "musicbrainz",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "MUSICBRAINZ_RELEASEID", id3: "TXXX:MUSICBRAINZ_RELEASEID", mp4: "----:com.apple.iTunes:MUSICBRAINZ_RELEASEID" },
  },
  {
    key: "mb_artistid",
    label: "MB Artist ID",
    group: "musicbrainz",
    gridDefault: false,
    placeholder: null,
    // Vorbis allows multiple for multi-artist releases
    multi:    { vorbis: true,  id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "MUSICBRAINZ_ARTISTID", id3: "TXXX:MUSICBRAINZ_ARTISTID", mp4: "----:com.apple.iTunes:MUSICBRAINZ_ARTISTID" },
  },
  {
    key: "mb_releasegroupid",
    label: "MB Release Group ID",
    group: "musicbrainz",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "MUSICBRAINZ_RELEASEGROUPID", id3: "TXXX:MUSICBRAINZ_RELEASEGROUPID", mp4: "----:com.apple.iTunes:MUSICBRAINZ_RELEASEGROUPID" },
  },
  {
    key: "mb_trackid",
    label: "MB Track ID",
    group: "musicbrainz",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "MUSICBRAINZ_TRACKID", id3: "TXXX:MUSICBRAINZ_TRACKID", mp4: "----:com.apple.iTunes:MUSICBRAINZ_TRACKID" },
    notes: "The release-specific track ID, distinct from the recording ID.",
  },

  // ── AcoustID ──────────────────────────────────────────────
  {
    key: "acoustid_id",
    label: "AcoustID",
    group: "acoustid",
    gridDefault: false,
    placeholder: null,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "ACOUSTID_ID", id3: "TXXX:Acoustid Id", mp4: "----:com.apple.iTunes:ACOUSTID_ID" },
  },
  {
    key: "acoustid_fingerprint",
    label: "AcoustID Fingerprint",
    group: "acoustid",
    gridDefault: false,
    placeholder: null,
    readOnly: true,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "ACOUSTID_FINGERPRINT", id3: "TXXX:Acoustid Fingerprint", mp4: "----:com.apple.iTunes:ACOUSTID_FINGERPRINT" },
    notes: "Computed by fpcalc; very long string. Usually not displayed directly.",
  },

  // ── Technical (read-only, computed from the file) ─────────
  {
    key: "encoder",
    label: "Encoder",
    group: "technical",
    gridDefault: false,
    placeholder: null,
    readOnly: true,
    multi:    { vorbis: false, id3: false, mp4: false },
    standard: { vorbis: false, id3: false, mp4: false },
    nativeKey: { vorbis: "ENCODED_BY", id3: "TSSE", mp4: "©too" },
  },
]

// ── Convenience lookups ──────────────────────────────────────

export const TAG_BY_KEY = Object.fromEntries(TAGS.map(t => [t.key, t]))

export const TAGS_BY_GROUP = TAGS.reduce((acc, t) => {
  ;(acc[t.group] ??= []).push(t)
  return acc
}, {})

// Tags that appear as placeholders in path/filename templates
export const PATH_PLACEHOLDER_TAGS = TAGS.filter(t => t.placeholder)

// Tags shown by default as grid columns
export const DEFAULT_GRID_TAGS = TAGS.filter(t => t.gridDefault)

// The universal core set shown in forms and grid by default
export const CORE_FIELD_TAGS = TAGS.filter(t => t.coreField)

// Groups in display order
export const TAG_GROUPS = [
  { key: "core",        label: "Core" },
  { key: "people",      label: "People" },
  { key: "content",     label: "Content" },
  { key: "release",     label: "Release" },
  { key: "replaygain",  label: "ReplayGain" },
  { key: "musicbrainz", label: "MusicBrainz" },
  { key: "acoustid",    label: "AcoustID" },
  { key: "technical",   label: "Technical" },
]
