import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const diceUtilities = require("../miniprogram/utils/dice.js");
const pageSource = readFileSync(
  new URL("../miniprogram/pages/index/index.js", import.meta.url),
  "utf8",
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const standardPhotos = () => ({
  mode: "default",
  single: null,
  faces: Array(6).fill(null),
});
const originalPhotos = () => ({
  mode: "single",
  single: "saved-original",
  faces: [null, null, "saved-face-three", null, null, null],
});
const event = (dataset) => ({ currentTarget: { dataset } });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function fakeClock() {
  let now = 10000;
  let sequence = 0;
  const timers = new Map();
  return {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, due: now + Math.max(0, delay || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = Array.from(timers.entries())
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

function makePage({
  photos = standardPhotos(),
  count = 1,
  roll,
  prepare,
} = {}) {
  const clock = fakeClock();
  const state = {
    photoSettings: clone(photos),
    files: new Set([photos.single, ...photos.faces].filter(Boolean)),
    operations: [],
    updates: [],
    rollCalls: [],
    privacyCalls: [],
    albumCalls: [],
  };
  const store = {
    defaultSettings: standardPhotos,
    load: () => clone(state.photoSettings),
    save(settings) {
      state.operations.push(["save", clone(settings)]);
      if (state.failSave) throw new Error("metadata could not be saved");
      state.photoSettings = clone(settings);
    },
    async prepare(files) {
      state.operations.push(["prepare", files]);
      const paths = prepare
        ? await prepare(files)
        : files.map((_, index) => `new-photo-${index}`);
      paths.forEach((path) => state.files.add(path));
      return paths;
    },
    async remove(paths) {
      state.operations.push(["remove", clone(paths)]);
      paths.forEach((path) => state.files.delete(path));
    },
    async clear() {
      state.operations.push(["clear"]);
      if (state.failClear) throw new Error("file cleanup failed");
      state.photoSettings = standardPhotos();
      state.files.clear();
    },
  };
  const wx = {
    getStorageSync: () => ({ count, soundEnabled: false }),
    setStorageSync: (key, value) =>
      state.operations.push(["saveGame", key, clone(value)]),
    showToast: (options) => state.operations.push(["toast", options.title]),
    requirePrivacyAuthorize(options) {
      state.operations.push(["privacy"]);
      state.privacyCalls.push(options);
    },
    chooseMedia(options) {
      state.operations.push(["album"]);
      state.albumCalls.push(options);
    },
    onNeedPrivacyAuthorization(listener) {
      state.privacyListener = listener;
    },
    offNeedPrivacyAuthorization(listener) {
      assert.equal(listener, state.privacyListener);
      state.privacyRemoved = true;
    },
  };
  let definition;
  vm.runInNewContext(
    pageSource,
    {
      Page(value) {
        definition = value;
      },
      wx,
      Date: clock.Date,
      Error,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      require(path) {
        if (path.endsWith("/dice.js"))
          return {
            ...diceUtilities,
            rollDice(number) {
              state.rollCalls.push(number);
              return roll
                ? roll(number)
                : Promise.resolve(Array(number).fill(6));
            },
          };
        if (path.endsWith("/photos.js"))
          return { createPhotoStore: () => store };
        throw new Error(`Unexpected dependency: ${path}`);
      },
    },
    { filename: "miniprogram/pages/index/index.js" },
  );
  const page = {
    ...definition,
    data: clone(definition.data),
    setData(patch) {
      state.updates.push(clone(patch));
      Object.assign(this.data, clone(patch));
    },
  };
  page.onLoad();
  return {
    page,
    state,
    clock,
    async grantPrivacy() {
      state.privacyCalls.at(-1).success({});
      await flushPromises();
    },
    async choose(number = 1) {
      state.albumCalls
        .at(-1)
        .success({
          tempFiles: Array.from({ length: number }, (_, index) => ({
            tempFilePath: `wxfile://tmp/photo-${index}.jpg`,
            size: 1000,
          })),
        });
      await flushPromises();
    },
  };
}

test("rolling locks repeat taps and count edits, then reveals the chosen top faces at two seconds", async () => {
  const pending = deferred();
  const { page, state, clock } = makePage({
    count: 2,
    roll: () => pending.promise,
  });
  const firstRoll = page.onRoll();
  await page.onRoll();
  page.onCountTap(event({ value: 6 }));
  await page.onChooseSingle();
  assert.deepEqual(state.rollCalls, [2]);
  assert.equal(page.data.count, 2);
  assert.equal(page.data.rolling, true);
  assert.equal(state.privacyCalls.length, 0);
  clock.advance(700);
  pending.resolve([6, 2]);
  await firstRoll;
  clock.advance(1299);
  assert.equal(page.data.rolling, true);
  assert.equal(page.data.history.length, 0);
  clock.advance(1);
  assert.equal(page.data.rolling, false);
  assert.equal(page.data.totalText, "8");
  assert.deepEqual(
    page.data.dice.map(({ value, rx, ry }) => [value, rx, ry]),
    [
      [6, -90, 0],
      [2, 0, 0],
    ],
  );
  assert.deepEqual(page.data.history[0].values, [6, 2]);
  assert.equal(
    state.operations.filter(([name]) => name === "saveGame").length,
    1,
  );
});

test("a slow random source does not restart the two-second animation after it responds", async () => {
  const pending = deferred();
  const { page, clock } = makePage({ roll: () => pending.promise });
  const rolling = page.onRoll();
  clock.advance(2500);
  pending.resolve([5]);
  await rolling;
  clock.advance(0);
  assert.equal(page.data.rolling, false);
  assert.equal(page.data.totalText, "5");
});

test("hiding cancels a pending random request and its late result cannot overwrite a fresh roll", async () => {
  const old = deferred();
  const fresh = deferred();
  const requests = [old, fresh];
  const { page, state, clock } = makePage({
    roll: () => requests.shift().promise,
  });
  const firstRoll = page.onRoll();
  page.onHide();
  assert.equal(page.data.rolling, false);
  const secondRoll = page.onRoll();
  fresh.resolve([3]);
  await secondRoll;
  clock.advance(2000);
  old.resolve([6]);
  await firstRoll;
  clock.advance(5000);
  assert.equal(page.data.totalText, "3");
  assert.deepEqual(
    page.data.history.map(({ values }) => values),
    [[3]],
  );
  assert.equal(
    state.operations.filter(([name]) => name === "saveGame").length,
    1,
  );
});

for (const lifecycle of ["onHide", "onUnload"]) {
  test(`${lifecycle} cancels a result already waiting for its animation timer`, async () => {
    const { page, state, clock } = makePage();
    await page.onRoll();
    clock.advance(1999);
    page[lifecycle]();
    const updatesAfterExit = state.updates.length;
    clock.advance(5000);
    assert.equal(page.data.rolling, false);
    assert.equal(page.data.history.length, 0);
    assert.equal(clock.pending(), 0);
    assert.equal(state.updates.length, updatesAfterExit);
    assert.equal(
      state.operations.filter(([name]) => name === "saveGame").length,
      0,
    );
  });
}

test("unloading while randomness is pending ignores both late success and late failure", async () => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const { page, state, clock } = makePage({ roll: () => pending.promise });
    const rolling = page.onRoll();
    page.onUnload();
    const updatesAfterUnload = state.updates.length;
    if (fail) pending.reject(new Error("late random failure"));
    else pending.resolve([6]);
    await rolling;
    clock.advance(5000);
    assert.equal(page.data.history.length, 0);
    assert.equal(clock.pending(), 0);
    assert.equal(state.updates.length, updatesAfterUnload);
    assert.equal(
      state.operations.filter(([name]) => name === "toast").length,
      0,
    );
    assert.equal(state.privacyRemoved, true);
  }
});

test("a failed metadata save preserves previous backgrounds and cleans newly copied photos", async () => {
  const harness = makePage({ photos: originalPhotos() });
  const { page, state } = harness;
  state.failSave = true;
  const choosing = page.onChooseSingle();
  await harness.grantPrivacy();
  await harness.choose();
  await choosing;
  assert.deepEqual(state.photoSettings, originalPhotos());
  assert.equal(page.data.singlePhoto, "saved-original");
  assert.equal(page.data.photoMode, "single");
  assert.equal(page.data.photoBusy, false);
  assert.deepEqual(Array.from(state.files).sort(), [
    "saved-face-three",
    "saved-original",
  ]);
  assert.deepEqual(
    state.operations.filter(([name]) => name === "remove"),
    [["remove", ["new-photo-0"]]],
  );
});

test("empty six-face mode leaves plain dice and a single face edit affects only its numbered face", async () => {
  const harness = makePage();
  const { page, state } = harness;
  page.onModeTap(event({ mode: "six" }));
  assert.equal(page.data.photoMode, "six");
  assert.ok(page.data.dice[0].faces.every((face) => face.photo === ""));
  assert.deepEqual(
    page.data.facePhotos.map(({ path }) => path),
    Array(6).fill(""),
  );
  const choosing = page.onChooseFace(event({ value: 3 }));
  await harness.grantPrivacy();
  await harness.choose();
  await choosing;
  const visiblePhotos = () =>
    page.data.dice[0].faces
      .filter(({ photo }) => photo)
      .map(({ value, photo }) => [value, photo]);
  assert.deepEqual(visiblePhotos(), [[3, "new-photo-0"]]);
  page.onModeTap(event({ mode: "default" }));
  assert.deepEqual(visiblePhotos(), []);
  assert.equal(state.files.has("new-photo-0"), true);
  page.onModeTap(event({ mode: "six" }));
  assert.deepEqual(visiblePhotos(), [[3, "new-photo-0"]]);
  assert.deepEqual(state.photoSettings.faces, [
    null,
    null,
    "new-photo-0",
    null,
    null,
    null,
  ]);
});

test("album access waits for privacy agreement and denial retains all previous photos", async () => {
  const { page, state } = makePage({ photos: originalPhotos() });
  const choosing = page.onChooseSingle();
  assert.equal(page.data.photoBusy, true);
  assert.equal(state.privacyCalls.length, 1);
  assert.equal(state.albumCalls.length, 0);
  state.privacyCalls[0].fail({
    errMsg: "requirePrivacyAuthorize:fail auth deny",
  });
  await choosing;
  assert.equal(state.albumCalls.length, 0);
  assert.deepEqual(state.photoSettings, originalPhotos());
  assert.equal(
    state.operations.filter(([name]) =>
      ["prepare", "save", "remove"].includes(name),
    ).length,
    0,
  );
  assert.equal(page.data.photoBusy, false);
  assert.match(page.data.photoStatus, /原来的设置已保留/);
});

test("six-photo selection opens only the album after consent and rejects an incomplete batch", async () => {
  const harness = makePage({ photos: originalPhotos() });
  const { page, state } = harness;
  const choosing = page.onChooseSix();
  await harness.grantPrivacy();
  assert.deepEqual(
    state.operations.map(([name]) => name),
    ["privacy", "album"],
  );
  assert.equal(state.albumCalls[0].count, 6);
  assert.deepEqual(clone(state.albumCalls[0].mediaType), ["image"]);
  assert.deepEqual(clone(state.albumCalls[0].sourceType), ["album"]);
  await harness.choose(5);
  await choosing;
  assert.match(page.data.photoStatus, /请选择六张|选择六张/);
  assert.deepEqual(state.photoSettings, originalPhotos());
  assert.equal(
    state.operations.filter(([name]) => name === "prepare").length,
    0,
  );
});

test("temporarily hiding for the native album does not cancel an authorized photo selection", async () => {
  const harness = makePage();
  const { page, state } = harness;
  const choosing = page.onChooseSingle();
  await harness.grantPrivacy();
  page.onHide();
  await harness.choose();
  await choosing;
  assert.equal(page.data.photoMode, "single");
  assert.equal(page.data.singlePhoto, "new-photo-0");
  assert.equal(state.photoSettings.single, "new-photo-0");
  assert.equal(page.data.photoBusy, false);
});

test("unloading during photo preparation cleans late copies without saving or updating the page", async () => {
  const prepared = deferred();
  const harness = makePage({
    photos: originalPhotos(),
    prepare: () => prepared.promise,
  });
  const { page, state } = harness;
  const choosing = page.onChooseSingle();
  await harness.grantPrivacy();
  await harness.choose();
  assert.equal(
    state.operations.filter(([name]) => name === "prepare").length,
    1,
  );
  page.onUnload();
  const updatesAfterUnload = state.updates.length;
  prepared.resolve(["new-late-photo"]);
  await choosing;
  assert.deepEqual(state.photoSettings, originalPhotos());
  assert.deepEqual(Array.from(state.files).sort(), [
    "saved-face-three",
    "saved-original",
  ]);
  assert.equal(state.operations.filter(([name]) => name === "save").length, 0);
  assert.deepEqual(
    state.operations.filter(([name]) => name === "remove"),
    [["remove", ["new-late-photo"]]],
  );
  assert.equal(state.updates.length, updatesAfterUnload);
});

test("photo reset saves standard settings before deleting copies and leaves photos intact if saving fails", async () => {
  const failed = makePage({ photos: originalPhotos() });
  failed.state.failSave = true;
  await failed.page.onResetPhotos();
  assert.equal(
    failed.state.operations.filter(([name]) => name === "clear").length,
    0,
  );
  assert.equal(failed.page.data.singlePhoto, "saved-original");
  assert.deepEqual(failed.state.photoSettings, originalPhotos());
  assert.equal(failed.state.files.size, 2);
  assert.equal(failed.page.data.photoBusy, false);

  const successful = makePage({ photos: originalPhotos() });
  await successful.page.onResetPhotos();
  assert.deepEqual(
    successful.state.operations.map(([name]) => name),
    ["save", "clear"],
  );
  assert.deepEqual(successful.state.operations[0][1], standardPhotos());
  assert.equal(successful.page.data.photoMode, "default");
  assert.equal(successful.state.files.size, 0);
});

test("a cleanup error after reset keeps the already-saved plain dice visible and reports the failure", async () => {
  const { page, state } = makePage({ photos: originalPhotos() });
  state.failClear = true;
  await page.onResetPhotos();
  assert.deepEqual(state.photoSettings, standardPhotos());
  assert.equal(page.data.photoMode, "default");
  assert.ok(page.data.dice[0].faces.every(({ photo }) => photo === ""));
  assert.equal(page.data.photoBusy, false);
  assert.match(page.data.photoStatus, /未能完全清除/);
});
