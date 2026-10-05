/**
 * Picking N distinct items at random.
 *
 * WHY THIS EXISTS
 * ---------------
 * The homepage's "Latest arrivals" row wants to show a handful of pieces drawn
 * at random from the newest N, rather than always the same top few. Doing that
 * in SQL with `ORDER BY random()` makes the database sort the entire active
 * catalogue, which no index can serve. Fetching the newest N through the
 * existing indexed query and shuffling those N here is strictly cheaper: the
 * database does the part it indexes well, and the shuffle is a few dozen
 * operations on an array that is already in memory.
 *
 * No database import, so it can be unit-tested directly.
 */

/**
 * The RNG source. Injectable so tests can pass a deterministic generator
 * instead of asserting against Math.random, which would make them flaky and
 * therefore useless.
 */
export type Rng = () => number;

/**
 * A random integer in [0, max).
 *
 * Math.random() is not integer-valued and cannot be used to index an array
 * directly. `% length` would bias toward low indices — 32 divides 256, but 6
 * does not divide 256, so index 0 would come up slightly more often than
 * index 5.
 *
 * Rejection sampling removes the bias: discard anything in the ragged tail and
 * try again. One draw is accepted ~97% of the time, so this costs nothing in
 * practice, and `max` is tiny here.
 */
function randomInt(max: number, rng: Rng): number {
  const limit = Math.floor(0x100000000 / max) * max;
  let value = Math.floor(rng() * 0x100000000);
  while (value >= limit) {
    value = Math.floor(rng() * 0x100000000);
  }
  return value % max;
}

/**
 * Fisher–Yates shuffle, in place.
 *
 * Walks backwards, swapping each element with a uniformly chosen one at or
 * before it. The backward walk is what makes every ordering equally likely —
 * the common "pick two random indices and swap" shortcut is not uniform.
 */
function shuffleInPlace<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

/**
 * Pick `count` items from `items` at random, without repeating any.
 *
 * Sampling WITHOUT replacement is the whole point: a caller rendering four
 * product cards must never get the same product twice, and because this
 * shuffles a list of distinct entries rather than drawing with replacement,
 * duplicates are impossible by construction — no dedup pass, no risk of
 * returning fewer than `count` items.
 *
 * The input is never mutated: the caller usually shares the fetched pool with
 * other sections, and mutating it would reorder their copy too.
 *
 * Returns a new array of at most `count` items. When `count` exceeds the
 * available items it returns them all, shuffled — which is the correct
 * degradation for a small catalogue rather than throwing.
 */
export function sampleWithoutReplacement<T>(
  items: readonly T[],
  count: number,
  rng: Rng = Math.random
): T[] {
  if (count <= 0 || items.length === 0) return [];

  const pool = items.slice();
  const take = Math.min(count, pool.length);
  shuffleInPlace(pool, rng);
  return pool.slice(0, take);
}