export const LIBRARY = [
  { artist: "Bad Brains", albums: [
    { name: "Bad Brains", year: 1982, genre: "Hardcore Punk", tracks: [
      { n: 1, title: "Sailin' On",         fmt: "FLAC", dur: "1:53" },
      { n: 2, title: "Don't Need It",      fmt: "FLAC", dur: "1:02" },
      { n: 3, title: "Attitude",           fmt: "FLAC", dur: "1:18", flag: "edited" },
      { n: 4, title: "The Regulator",      fmt: "FLAC", dur: "2:06", flag: "edited" },
      { n: 5, title: "Banned in D.C.",     fmt: "FLAC", dur: "2:18" },
      { n: 6, title: "Pay to Cum",         fmt: "FLAC", dur: "1:33" },
    ]},
    { name: "I Against I", year: 1986, genre: "Hardcore Punk", tracks: [
      { n: 1, title: "Intro",              fmt: "FLAC", dur: "0:43" },
      { n: 2, title: "I Against I",        fmt: "FLAC", dur: "3:02" },
      { n: 3, title: "House of Suffering", fmt: "FLAC", dur: "2:33" },
    ]},
  ]},
  { artist: "Black Flag", albums: [
    { name: "Damaged", year: 1981, genre: "Hardcore Punk", tracks: [
      { n: 1, title: "Rise Above",   fmt: "MP3", dur: "2:26" },
      { n: 2, title: "Spray Paint",  fmt: "MP3", dur: "0:34" },
      { n: 3, title: "Six Pack",     fmt: "MP3", dur: "2:21" },
    ]},
  ]},
  { artist: "Dead Kennedys", albums: [
    { name: "Fresh Fruit for Rotting Vegetables", year: 1980, genre: "Hardcore Punk", tracks: [
      { n: 1, title: "Kill the Poor",       fmt: "OGG", dur: "3:04" },
      { n: 2, title: "Holiday in Cambodia", fmt: "OGG", dur: "4:36" },
    ]},
  ]},
  { artist: "The Clash", albums: [
    { name: "London Calling", year: 1979, genre: "Punk Rock", tracks: [
      { n: 1, title: "London Calling",     fmt: "M4A", dur: "3:19" },
      { n: 2, title: "Brand New Cadillac", fmt: "M4A", dur: "2:09" },
      { n: 3, title: "Jimmy Jazz",         fmt: "M4A", dur: "3:54" },
    ]},
  ]},
]

// Flat track list for grid view
export const TRACKS = []
let _tid = 1
LIBRARY.forEach(a => a.albums.forEach(al => al.tracks.forEach(t => {
  TRACKS.push({
    id: _tid++,
    title: t.title, artist: a.artist, albumartist: a.artist,
    album: al.name, year: al.year, genre: al.genre,
    track: `${String(t.n).padStart(2, "0")}/${String(al.tracks.length).padStart(2, "0")}`,
    fmt: t.fmt, dur: t.dur, flag: t.flag || null,
    bpm: null, composer: null, comment: null, label: null,
    discnumber: "1/1", isrc: null,
  })
})))

export const INBOX = [
  { id: 1, file: "untitled-04.flac", fmt: "FLAC", title: null, artist: null, album: null, art: false, fp: null, issues: ["no-tags"] },
  { id: 2, file: "untitled-05.flac", fmt: "FLAC", title: null, artist: null, album: null, art: false, fp: "matched", match: "Police Truck — Dead Kennedys", confidence: 97, issues: ["no-tags"] },
  { id: 3, file: "01_rise_above.mp3", fmt: "MP3", title: "Rise Above", artist: "Black Flag", album: "Damaged", art: false, issues: ["no-art"] },
  { id: 4, file: "tk04.mp3", fmt: "MP3", title: null, artist: "Black Flag", album: "Damaged", art: false, fp: "matched", match: "TV Party — Black Flag", confidence: 88, issues: ["no-title", "no-art"] },
  { id: 5, file: "London Calling - remaster [HQ] (1).m4a", fmt: "M4A", title: "London Calling", artist: "The Clash", album: "London Calling", art: true, issues: ["dirty-filename", "duplicate"] },
  { id: 6, file: "01.ogg", fmt: "OGG", title: "Holiday in Cambodia", artist: "Dead Kennedys", album: "Fresh Fruit for Rotting Vegetables", art: true, issues: ["low-bitrate"] },
  { id: 7, file: "corrupt-flac.flac", fmt: "FLAC", title: null, artist: null, album: null, art: false, issues: ["crc-fail"] },
]
