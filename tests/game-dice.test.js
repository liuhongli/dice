import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { rollDice } = require("../minigame/dice.js");

test("game prefers UserCryptoManager with its receiver and rejects biased bytes", async () => {
  const batches = [[0, 5, 252], [2]];
  const manager = {
    getRandomValues({ length, success }) {
      assert.equal(this, manager);
      const bytes = batches.shift(); assert.equal(bytes.length, length);
      success({ randomValues: Uint8Array.from(bytes).buffer });
    },
  };
  const wxApi = {
    getUserCryptoManager() { assert.equal(this, wxApi); return manager; },
    getRandomValues() { assert.fail("game should prefer its native manager"); },
  };
  assert.deepEqual(await rollDice(3, wxApi), [1, 6, 3]);
  assert.equal(batches.length, 0);
});

test("missing, throwing and failing game random APIs retain playable independent dice", async (t) => {
  for (const api of [
    {},
    { getUserCryptoManager: () => null },
    { getUserCryptoManager() { throw new Error("unavailable"); } },
    { getUserCryptoManager: () => ({ getRandomValues: ({ fail }) => fail({ errMsg: "unavailable" }) }) },
  ]) {
    const values = [0, 0.999999, 0.5];
    const fallback = t.mock.method(Math, "random", () => values.shift());
    assert.deepEqual(await rollDice(3, api), [1, 6, 4]);
    assert.equal(values.length, 0);
    fallback.mock.restore();
  }
});

test("a silent game crypto manager falls back at 500ms and ignores late callbacks", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  t.mock.method(Math, "random", () => 0.5);
  let callbacks;
  let resolved = false;
  const pending = rollDice(2, {
    getUserCryptoManager: () => ({ getRandomValues(options) { callbacks = options; } }),
  });
  pending.then(() => { resolved = true; });
  t.mock.timers.tick(499); await Promise.resolve();
  assert.equal(resolved, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, [4, 4]);
  callbacks.success({ randomValues: Uint8Array.from([0, 5]).buffer });
  callbacks.fail({ errMsg: "late failure" });
  assert.deepEqual(await pending, [4, 4]);
});
