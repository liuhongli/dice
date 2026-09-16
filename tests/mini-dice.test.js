import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { FACE_VALUES, TOP_ORIENTATIONS } from "../dice-geometry.js";

const require = createRequire(import.meta.url);
const miniDice = require("../miniprogram/utils/dice.js");

function randomSource(batches) {
  const requests = [];
  return {
    requests,
    getRandomValues({ length, success }) {
      requests.push(length);
      const bytes = batches.shift();
      assert.equal(bytes.length, length);
      success({ randomValues: Uint8Array.from(bytes).buffer });
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

test("uses the direct WeChat random API with its receiver without accessing user encryption", async () => {
  let receiver;
  let managerCalls = 0;
  const wxApi = {
    getRandomValues({ success }) {
      receiver = this;
      success({ randomValues: Uint8Array.from([0, 5]).buffer });
    },
    getUserCryptoManager() {
      managerCalls += 1;
      throw new Error("user encryption unavailable");
    },
  };
  assert.deepEqual(await miniDice.rollDice(2, wxApi), [1, 6]);
  assert.equal(receiver, wxApi);
  assert.equal(managerCalls, 0);
});

test("clients without the direct API remain playable even with an incomplete crypto manager", async (t) => {
  for (const wxApi of [undefined, {}, { getUserCryptoManager: () => ({}) }]) {
    const values = [0, 0.999999, 0.5];
    const fallback = t.mock.method(Math, "random", () => values.shift());
    assert.deepEqual(await miniDice.rollDice(3, wxApi), [1, 6, 4]);
    assert.equal(values.length, 0);
    fallback.mock.restore();
  }
});

test("native API failures and malformed results fall back to independent dice", async (t) => {
  const providers = [
    ({ fail }) => fail({ errMsg: "getRandomValues:fail unavailable" }),
    () => {
      throw new Error("native bridge unavailable");
    },
    ({ success }) => success(),
    ({ success }) => success({ randomValues: new ArrayBuffer(0) }),
    ({ success }) => success({ randomValues: new ArrayBuffer(2) }),
    ({ success }) => success({ randomValues: new Uint8Array(3) }),
    ({ success }) => success({ randomValues: { byteLength: 3 } }),
  ];
  for (const getRandomValues of providers) {
    const values = [0, 0.999999, 0.5];
    const fallback = t.mock.method(Math, "random", () => values.shift());
    assert.deepEqual(await miniDice.rollDice(3, { getRandomValues }), [1, 6, 4]);
    assert.equal(values.length, 0);
    fallback.mock.restore();
  }
});

test("accepts valid ArrayBuffers returned from a different JavaScript context", async (t) => {
  const buffer = runInNewContext("new Uint8Array([0, 5, 3]).buffer");
  assert.equal(buffer instanceof ArrayBuffer, false);
  const fallback = t.mock.method(Math, "random", () => 0.5);
  const wxApi = {
    getRandomValues: ({ success }) => success({ randomValues: buffer }),
  };
  assert.deepEqual(await miniDice.rollDice(3, wxApi), [1, 6, 4]);
  assert.equal(fallback.mock.callCount(), 0);
});

test("exhausting rejected bytes falls back instead of leaving dice rolling", async (t) => {
  let requests = 0;
  const fallback = t.mock.method(Math, "random", () => 0.5);
  const wxApi = {
    getRandomValues({ length, success }) {
      requests += 1;
      success({ randomValues: new Uint8Array(length).fill(255).buffer });
    },
  };
  assert.deepEqual(await miniDice.rollDice(2, wxApi), [4, 4]);
  assert.equal(requests, 128);
  assert.equal(fallback.mock.callCount(), 2);
});

test("a failure after a partial random result redraws all dice independently", async (t) => {
  const values = [0, 0.5, 0.999999];
  t.mock.method(Math, "random", () => values.shift());
  let requests = 0;
  const wxApi = {
    getRandomValues({ success, fail }) {
      if (requests++ === 0) {
        success({ randomValues: Uint8Array.from([5, 252, 255]).buffer });
      } else {
        fail({ errMsg: "unavailable" });
      }
    },
  };
  assert.deepEqual(await miniDice.rollDice(3, wxApi), [1, 4, 6]);
  assert.equal(values.length, 0);
});

test("an API that never responds falls back after 500ms and ignores late callbacks", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const values = [0, 0.5, 0.999999];
  const fallback = t.mock.method(Math, "random", () => values.shift());
  let callbacks;
  const pending = miniDice.rollDice(3, {
    getRandomValues(options) {
      callbacks = options;
    },
  });
  t.mock.timers.tick(499);
  await Promise.resolve();
  assert.equal(fallback.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, [1, 4, 6]);
  callbacks.success({ randomValues: Uint8Array.from([5, 5, 5]).buffer });
  callbacks.fail({ errMsg: "late error" });
  assert.deepEqual(await pending, [1, 4, 6]);
  assert.equal(fallback.mock.callCount(), 3);
});

test("the 500ms limit is shared across replacement byte requests", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const fallback = t.mock.method(Math, "random", () => 0.5);
  let requests = 0;
  const pending = miniDice.rollDice(1, {
    getRandomValues({ success }) {
      if (requests++ === 0) {
        setTimeout(
          () => success({ randomValues: Uint8Array.from([255]).buffer }),
          300,
        );
      }
    },
  });
  t.mock.timers.tick(300);
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.equal(requests, 2);
  t.mock.timers.tick(199);
  await Promise.resolve();
  assert.equal(fallback.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, [4]);
  assert.equal(fallback.mock.callCount(), 1);
});

test("successful random draws cancel their timeout and keep the result stable", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const clear = t.mock.method(globalThis, "clearTimeout");
  const fallback = t.mock.method(Math, "random", () => 0.5);
  const pending = miniDice.rollDice(2, randomSource([[0, 5]]));
  assert.deepEqual(await pending, [1, 6]);
  assert.ok(clear.mock.callCount() > 0);
  t.mock.timers.tick(1000);
  assert.deepEqual(await pending, [1, 6]);
  assert.equal(fallback.mock.callCount(), 0);
});
