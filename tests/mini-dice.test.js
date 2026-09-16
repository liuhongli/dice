import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FACE_VALUES, TOP_ORIENTATIONS } from "../dice-geometry.js";

const require = createRequire(import.meta.url);
const miniDice = require("../miniprogram/utils/dice.js");

function randomSource(batches) {
  const requests = [];
  return {
    requests,
    getUserCryptoManager() {
      return {
        getRandomValues({ length, success }) {
          requests.push(length);
          const bytes = batches.shift();
          assert.equal(bytes.length, length);
          success({ randomValues: Uint8Array.from(bytes).buffer });
        },
      };
    },
  };
}

test("mini program uses the web dice's face values and upward result rotations", () => {
  assert.deepEqual(miniDice.FACE_VALUES, FACE_VALUES);
  assert.deepEqual(miniDice.TOP_ORIENTATIONS, TOP_ORIENTATIONS);
  assert.equal(miniDice.MAX_DICE, 6);
});

test("mini program count accepts numeric selections and clamps invalid inputs", () => {
  for (const [input, expected] of [
    ["4", 4],
    [6.9, 6],
    [99, 6],
    [0, 1],
    [null, 1],
    [Infinity, 1],
    ["no", 1],
  ]) {
    assert.equal(miniDice.normalizeDiceCount(input), expected);
  }
});

test("rejected random bytes are replaced without modulo bias or losing accepted rolls", async () => {
  const wxApi = randomSource([
    [252, 253, 254, 255, 0, 5],
    [1, 2, 3, 4],
  ]);
  assert.deepEqual(await miniDice.rollDice(6, wxApi), [1, 6, 2, 3, 4, 5]);
  assert.deepEqual(wxApi.requests, [6, 4]);
});

test("every accepted byte contributes equally and separate dice may share a face", async () => {
  const batches = Array.from({ length: 42 }, (_, i) =>
    Array.from({ length: 6 }, (_, j) => i * 6 + j),
  );
  const source = randomSource(batches);
  const frequencies = Array(6).fill(0);
  for (let i = 0; i < 42; i += 1) {
    for (const face of await miniDice.rollDice(6, source))
      frequencies[face - 1] += 1;
  }
  assert.deepEqual(frequencies, [42, 42, 42, 42, 42, 42]);
  assert.deepEqual(
    await miniDice.rollDice(3, randomSource([[0, 0, 0]])),
    [1, 1, 1],
  );
});

test("crypto errors and malformed buffers fail instead of silently changing sources", async (t) => {
  t.mock.method(Math, "random", () => {
    throw new Error("fallback should not run");
  });
  const failed = {
    getUserCryptoManager: () => ({
      getRandomValues: ({ fail }) => fail({ errMsg: "unavailable" }),
    }),
  };
  const malformed = {
    getUserCryptoManager: () => ({
      getRandomValues: ({ success }) =>
        success({ randomValues: new ArrayBuffer(0) }),
    }),
  };
  await assert.rejects(miniDice.rollDice(2, failed), /随机点数生成失败/);
  await assert.rejects(miniDice.rollDice(2, malformed), /随机点数生成失败/);
});

test("legacy clients use an independent game-only random draw for each die", async (t) => {
  const values = [0, 0.999999, 0.5];
  t.mock.method(Math, "random", () => values.shift());
  assert.deepEqual(await miniDice.rollDice(3, {}), [1, 6, 4]);
  assert.equal(values.length, 0);
});

test("a broken crypto provider cannot leave a roll pending indefinitely", async () => {
  const api = {
    getUserCryptoManager: () => ({
      getRandomValues({ length, success }) {
        success({ randomValues: new Uint8Array(length).fill(255).buffer });
      },
    }),
  };
  await assert.rejects(miniDice.rollDice(1, api), /随机点数生成失败/);
});
