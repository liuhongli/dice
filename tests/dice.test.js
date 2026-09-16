import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DICE, normalizeDiceCount, rollDice } from "../dice.js";

function cryptoFromBytes(bytes) {
  let offset = 0;
  const fills = [];

  return {
    fills,
    getRandomValues(target) {
      assert.ok(target instanceof Uint8Array);
      assert.ok(
        offset + target.length <= bytes.length,
        "Unexpected random byte request",
      );
      fills.push(target.length);
      target.set(bytes.slice(offset, offset + target.length));
      offset += target.length;
      return target;
    },
  };
}

test("normalizes whole and fractional counts and clamps the supported range", () => {
  assert.equal(MAX_DICE, 6);
  for (const [input, expected] of [
    [1, 1],
    [6, 6],
    [3, 3],
    ["4", 4],
    [" 5 ", 5],
    [3.9, 3],
    ["2.8", 2],
    [0, 1],
    [-4, 1],
    [7, 6],
    [Number.MAX_VALUE, 6],
  ]) {
    assert.equal(normalizeDiceCount(input), expected);
  }
});

test("invalid counts safely default to one without coercing objects", () => {
  const hostileObject = {
    valueOf() {
      throw new Error("Must not coerce objects");
    },
  };
  for (const value of [
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    "",
    "dice",
    true,
    [],
    {},
    Symbol("dice"),
    3n,
    hostileObject,
  ]) {
    assert.equal(normalizeDiceCount(value), 1);
  }
});

test("each accepted random byte independently produces its corresponding face", () => {
  const source = cryptoFromBytes([
    0, 1, 2, 3, 4, 5, 251, 250, 249, 248, 247, 246,
  ]);
  assert.deepEqual(rollDice(6, source), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rollDice(6, source), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(source.fills, [6, 6]);
});

test("rejects high bytes and refills until every requested die has a result", () => {
  const source = cryptoFromBytes([252, 1, 255, 2, 251, 254, 253, 0]);
  assert.deepEqual(rollDice(4, source), [2, 3, 6, 1]);
  assert.deepEqual(source.fills, [4, 2, 1, 1]);
});

test("all 252 accepted byte values produce equally many results for each face", () => {
  const source = cryptoFromBytes(
    Array.from({ length: 252 }, (_, index) => index),
  );
  const frequencies = Array(6).fill(0);
  for (let batch = 0; batch < 42; batch += 1) {
    const dice = rollDice(6, source);
    assert.equal(dice.length, 6);
    for (const face of dice) {
      assert.ok(Number.isInteger(face) && face >= 1 && face <= 6);
      frequencies[face - 1] += 1;
    }
  }
  assert.deepEqual(frequencies, [42, 42, 42, 42, 42, 42]);
});

test("rollDice uses the same count normalization and creates fresh results", () => {
  const source = cryptoFromBytes([0, 1, 2, 3, 4, 5, 1, 2, 3]);
  const first = rollDice(100, source);
  assert.equal(first.length, 6);
  assert.deepEqual(rollDice("2.9", source), [2, 3]);
  assert.deepEqual(rollDice("invalid", source), [4]);
  assert.deepEqual(first, [1, 2, 3, 4, 5, 6]);
});

test("reports an unusable randomness source clearly", () => {
  for (const source of [null, {}, { getRandomValues: true }]) {
    assert.throws(
      () => rollDice(1, source),
      /crypto source with getRandomValues/,
    );
  }
});
