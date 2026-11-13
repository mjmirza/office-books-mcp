import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { TokenBucket } from "../../src/api/rate-limit.js";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

test("allows a burst up to capacity without waiting", async () => {
  const c = fakeClock();
  const b = new TokenBucket({ capacity: 2, refillPerSecond: 2, now: c.now, sleep: c.sleep });
  await b.take();
  await b.take();
  assert.equal(c.now(), 0);
});

test("waits for a refill once the bucket is empty", async () => {
  const c = fakeClock();
  const b = new TokenBucket({ capacity: 2, refillPerSecond: 2, now: c.now, sleep: c.sleep });
  await b.take();
  await b.take();
  await b.take();
  assert.equal(c.now(), 500);
});

test("rejects a non-positive rate", () => {
  assert.throws(() => new TokenBucket({ capacity: 2, refillPerSecond: 0 }));
  assert.throws(() => new TokenBucket({ capacity: 0, refillPerSecond: 2 }));
});

test("property: n takes never run faster than the configured rate", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 5 }), async (n, rate) => {
      const c = fakeClock();
      const b = new TokenBucket({ capacity: rate, refillPerSecond: rate, now: c.now, sleep: c.sleep });
      for (let i = 0; i < n; i++) await b.take();
      const allowed = rate + (c.now() / 1000) * rate;
      return n <= allowed + 1e-9;
    }),
  );
});
