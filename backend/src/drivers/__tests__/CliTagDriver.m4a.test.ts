import { test } from 'node:test'
// AtomicParsley is not installed on this system.
// These tests document expected behaviour and will run once the binary is available.
test('M4A — all tests skipped: AtomicParsley not installed', t => {
  t.skip('AtomicParsley binary not found at /opt/homebrew/bin/AtomicParsley — install it to enable')
})
