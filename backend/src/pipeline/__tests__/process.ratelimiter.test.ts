import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeRateLimiter, CONCURRENCY } from '../process.js'

describe('makeRateLimiter', () => {
  test('first caller resolves immediately', async () => {
    const acquire = makeRateLimiter(50)
    const start = Date.now()
    await acquire()
    const elapsed = Date.now() - start
    // Should resolve in well under the gap period
    assert.ok(elapsed < 40, `Expected < 40ms, got ${elapsed}ms`)
  })

  test('second caller waits at least minGapMs', async () => {
    const GAP = 80
    const acquire = makeRateLimiter(GAP)
    await acquire()
    const start = Date.now()
    await acquire()
    const elapsed = Date.now() - start
    assert.ok(elapsed >= GAP - 10, `Expected >= ${GAP - 10}ms gap, got ${elapsed}ms`)
  })

  test('N concurrent callers are serialised with gaps between them', async () => {
    const GAP = 50
    const acquire = makeRateLimiter(GAP)
    const N = 4
    const times: number[] = []

    await Promise.all(
      Array.from({ length: N }, async () => {
        await acquire()
        times.push(Date.now())
      })
    )

    // Sort acquisition times and verify each gap is at least GAP - 10ms
    times.sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1]
      assert.ok(gap >= GAP - 10, `Gap between callers ${i - 1} and ${i} was ${gap}ms, expected >= ${GAP - 10}ms`)
    }
  })

  test('total time for N callers is approximately (N-1) * gap', async () => {
    const GAP = 40
    const N = 5
    const acquire = makeRateLimiter(GAP)
    const start = Date.now()
    await Promise.all(Array.from({ length: N }, () => acquire()))
    const elapsed = Date.now() - start
    const expectedMin = (N - 1) * GAP - 20
    assert.ok(elapsed >= expectedMin, `Expected >= ${expectedMin}ms for ${N} callers, got ${elapsed}ms`)
  })

  test('independent limiters do not affect each other', async () => {
    const limiter1 = makeRateLimiter(200)
    const limiter2 = makeRateLimiter(200)
    const start = Date.now()
    // Both first calls should resolve roughly simultaneously
    await Promise.all([limiter1(), limiter2()])
    const elapsed = Date.now() - start
    assert.ok(elapsed < 50, `Independent limiters should not block each other: ${elapsed}ms`)
  })
})

describe('CONCURRENCY', () => {
  test('is a positive integer', () => {
    assert.ok(Number.isInteger(CONCURRENCY))
    assert.ok(CONCURRENCY > 0)
  })

  test('is 5', () => {
    assert.equal(CONCURRENCY, 5)
  })
})
