import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGame } = require("../minigame/controller.js");
const clone = (value) => JSON.parse(JSON.stringify(value));
const defaults = () => ({ mode: "default", single: null, faces: Array(6).fill(null) });
const originals = () => ({ mode: "single", single: "old-single", faces: [null, null, "old-face", null, null, null] });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness({ saved = {}, photos = defaults(), randomRoll, select } = {}) {
  let time = 10000;
  let timerId = 0;
  const timers = new Map();
  const observed = {
    rolls: [], saves: [], removals: [], toasts: [], selected: [], invalidations: 0, clears: 0,
    photos: clone(photos), files: new Set([photos.single, ...photos.faces].filter(Boolean)),
  };
  const photoStore = {
    defaultSettings: defaults,
    load: () => clone(observed.photos),
    save(next) {
      observed.saves.push(["photos", clone(next)]);
      if (observed.failSave) throw new Error("照片保存失败");
      observed.photos = clone(next);
    },
    async select(count) {
      observed.selected.push(count);
      const paths = select ? await select(count) : Array.from({ length: count }, (_, i) => `new-${i}`);
      paths.forEach((path) => observed.files.add(path));
      return paths;
    },
    async remove(paths) {
      observed.removals.push(paths.slice());
      if (observed.failRemove) throw new Error("cleanup failed");
      paths.forEach((path) => observed.files.delete(path));
    },
    async clear() {
      observed.clears += 1;
      observed.photos = defaults();
      await this.remove([...observed.files]);
    },
  };
  const wxApi = {
    getStorageSync: () => clone(saved),
    setStorageSync: (key, next) => observed.saves.push(["game", clone(next)]),
    showToast: ({ title }) => observed.toasts.push(title),
    showModal: ({ success }) => success({ confirm: observed.confirm !== false }),
  };
  const game = createGame({
    wxApi, photoStore,
    now: () => time,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: time + delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    invalidate: () => { observed.invalidations += 1; },
    randomRoll(count) { observed.rolls.push(count); return randomRoll ? randomRoll(count) : Promise.resolve(Array(count).fill(6)); },
  });
  return {
    game, observed,
    action: (action, value) => game.handleAction({ action, value }),
    advance(amount) {
      const target = time + amount;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].due; next[1].callback();
      }
      time = target;
    },
    pendingTimers: () => timers.size,
  };
}

test("game locks repeat taps and edits until exactly two seconds after the roll began", async () => {
  const pending = deferred();
  const h = harness({ saved: { count: 2 }, randomRoll: () => pending.promise });
  const rolling = h.action("roll");
  await h.action("roll"); h.action("count", 6); await h.action("chooseSingle");
  assert.equal(h.game.state.count, 2);
  assert.deepEqual(h.observed.rolls, [2]);
  assert.deepEqual(h.observed.selected, []);
  h.advance(450); pending.resolve([1, 6]); await rolling;
  h.advance(1549);
  assert.equal(h.game.state.rolling, true);
  assert.equal(h.game.state.resultReady, false);
  assert.equal(h.game.state.history.length, 0);
  h.advance(1);
  assert.equal(h.game.state.rolling, false);
  assert.equal(h.game.state.resultReady, true);
  assert.deepEqual(h.game.state.values, [1, 6]);
  assert.deepEqual(h.game.state.history, [{ values: [1, 6], time: 12000 }]);
  assert.deepEqual(h.observed.saves.at(-1)[1].history, h.game.state.history);
});

test("hiding rolls back a pending target and ignores old random callbacks after a new roll", async () => {
  const first = deferred(); const second = deferred();
  const requests = [first, second];
  const h = harness({ randomRoll: () => requests.shift().promise });
  const original = h.game.state.values.slice();
  const old = h.action("roll"); h.game.hide();
  assert.deepEqual(h.game.state.values, original);
  const fresh = h.action("roll"); second.resolve([2]); await fresh;
  h.advance(2000);
  first.resolve([6]); await old; h.advance(5000);
  assert.deepEqual(h.game.state.values, [2]);
  assert.deepEqual(h.game.state.history.map((row) => row.values), [[2]]);
  assert.equal(h.pendingTimers(), 0);
});

test("hide and destroy cancel an armed timer and restore the previous visible result", async () => {
  for (const method of ["hide", "destroy"]) {
    const results = [[2], [5]];
    const h = harness({ randomRoll: () => Promise.resolve(results.shift()) });
    await h.action("roll"); h.advance(2000);
    const finished = clone(h.game.state.history);
    const values = h.game.state.values.slice();
    await h.action("roll"); h.advance(1900);
    assert.deepEqual(h.game.state.values, [5]);
    h.game[method]();
    const invalidations = h.observed.invalidations;
    h.advance(5000);
    assert.equal(h.game.state.rolling, false);
    assert.equal(h.game.state.resultReady, true);
    assert.deepEqual(h.game.state.values, values);
    assert.deepEqual(h.game.state.history, finished);
    assert.equal(h.pendingTimers(), 0);
    assert.equal(h.observed.invalidations, invalidations);
  }
});

test("history drops corrupt saved entries and persists only the latest eight completed rolls", async () => {
  const h = harness({ saved: { count: 2, history: [null, { values: [7], time: 1 }, { values: [4, 2], time: 42 }] } });
  assert.deepEqual(h.game.state.history, [{ values: [4, 2], time: 42 }]);
  for (let i = 0; i < 10; i += 1) { await h.action("roll"); h.advance(2000); }
  assert.equal(h.game.state.history.length, 8);
  assert.deepEqual(h.game.state.history.map((row) => row.time), [30000, 28000, 26000, 24000, 22000, 20000, 18000, 16000]);
  assert.deepEqual(h.observed.saves.at(-1)[1].history, h.game.state.history);
  h.action("clearHistory");
  assert.deepEqual(h.observed.saves.at(-1)[1].history, []);
});

test("a failed photo metadata save keeps old images and removes newly copied images", async () => {
  const h = harness({ photos: originals() }); h.observed.failSave = true;
  await h.action("chooseSingle");
  assert.deepEqual(h.game.state.photos, originals());
  assert.deepEqual([...h.observed.files].sort(), ["old-face", "old-single"]);
  assert.deepEqual(h.observed.removals, [["new-0"]]);
  assert.equal(h.game.state.photoBusy, false);
  assert.match(h.observed.toasts[0], /保存失败/);
});

test("photo replacement preserves inactive face photos and retires only replaced paths", async () => {
  const h = harness({ photos: originals() });
  await h.action("chooseSingle");
  assert.equal(h.game.state.photos.single, "new-0");
  assert.equal(h.game.state.photos.faces[2], "old-face");
  assert.deepEqual(h.observed.removals, [["old-single"]]);
  assert.deepEqual([...h.observed.files].sort(), ["new-0", "old-face"]);
  await h.action("chooseSix");
  assert.equal(h.game.state.photos.mode, "six");
  assert.deepEqual(h.game.state.photos.faces, ["new-0", "new-1", "new-2", "new-3", "new-4", "new-5"]);
  assert.deepEqual(h.observed.removals.at(-1), ["old-face"]);
});

test("editing a numbered face affects only that face and cancellation preserves settings", async () => {
  const h = harness({ photos: originals() });
  await h.action("chooseFace", 5);
  assert.equal(h.game.state.photos.mode, "six");
  assert.deepEqual(h.game.state.photos.faces, [null, null, "old-face", null, "new-0", null]);
  const cancelled = new Error("cancel"); cancelled.cancelled = true;
  const denied = harness({ photos: originals(), select: () => Promise.reject(cancelled) });
  await denied.action("chooseSingle");
  assert.deepEqual(denied.game.state.photos, originals());
  assert.deepEqual(denied.observed.saves, []);
  assert.deepEqual(denied.observed.toasts, []);
  assert.equal(denied.game.state.photoBusy, false);
});

test("native album hide does not discard a selection, but destroyed games remove late copies", async () => {
  for (const method of ["hide", "destroy"]) {
    const pending = deferred();
    const h = harness({ photos: originals(), select: () => pending.promise });
    const choosing = h.action("chooseSingle"); h.game[method]();
    pending.resolve(["late-photo"]); await choosing;
    assert.equal(h.game.state.photoBusy, false);
    if (method === "hide") assert.equal(h.game.state.photos.single, "late-photo");
    else {
      assert.deepEqual(h.game.state.photos, originals());
      assert.deepEqual(h.observed.removals, [["late-photo"]]);
      assert.deepEqual(h.observed.saves, []);
    }
  }
});

test("clear confirmation cancellation and storage failure retain backgrounds", async () => {
  for (const reason of ["cancel", "storage"]) {
    const h = harness({ photos: originals() });
    if (reason === "cancel") h.observed.confirm = false;
    else h.observed.failSave = true;
    await h.action("clearPhotos");
    assert.deepEqual(h.game.state.photos, originals());
    assert.deepEqual(h.observed.removals, []);
    assert.equal(h.observed.clears, 0);
    assert.equal(h.game.state.photoBusy, false);
  }
});

test("clear removes stored photos after committing default settings and reports cleanup failures", async () => {
  for (const fail of [false, true]) {
    const h = harness({ photos: originals() }); h.observed.failRemove = fail;
    await h.action("clearPhotos");
    assert.deepEqual(h.game.state.photos, defaults());
    assert.deepEqual(h.observed.photos, defaults());
    assert.deepEqual(h.observed.removals, [["old-single", "old-face"]]);
    assert.equal(h.observed.clears, 1);
    if (fail) assert.match(h.game.state.photoStatus, /部分旧照片暂时无法清理/);
    else assert.equal(h.observed.files.size, 0);
    assert.equal(h.game.state.photoBusy, false);
  }
});

test("retrying photo reset removes leftover files even after the first reset committed plain dice", async () => {
  const h = harness({ photos: originals() });
  h.observed.files.add("older-orphan");
  h.observed.failRemove = true;
  await h.action("clearPhotos");
  assert.deepEqual(h.game.state.photos, defaults());
  assert.equal(h.observed.files.size, 3);
  h.observed.failRemove = false;
  await h.action("clearPhotos");
  assert.equal(h.observed.files.size, 0);
  assert.equal(h.observed.clears, 2);
  assert.deepEqual(h.observed.removals.at(-1), ["old-single", "old-face", "older-orphan"]);
  assert.equal(h.game.state.photoBusy, false);
});
