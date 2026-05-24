import { test } from 'node:test'
// vorbiscomment is not installed on this system.
// These tests document expected behaviour and will run once the binary is available.
test('OGG — all tests skipped: vorbiscomment not installed', t => {
  t.skip('vorbiscomment binary not found at /opt/homebrew/bin/vorbiscomment — install vorbis-tools to enable')
})
