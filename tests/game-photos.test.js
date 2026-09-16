import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPhotoStore } = require("../minigame/photos.js");
const directory = "wxfile://usr/dice-party-game-photos";
const oldPhoto = `${directory}/photo-old-1-a.jpg`;
const originalSettings = () => ({ mode: "single", single: oldPhoto, faces: Array(6).fill(null) });
const chosen = (index = 0) => ({ tempFilePath: `wxfile://tmp/chosen-${index}.jpg`, size: 2048, fileType: "image" });

function mockWechat() {
  const state = {
    settings: originalSettings(),
    files: new Map([[oldPhoto, "old image"]]),
    directories: new Set(["wxfile://usr", directory]),
    operations: [],
    selection: [chosen()],
    copies: 0,
  };
  const fs = {
    accessSync(path) {
      if (!state.files.has(path) && !state.directories.has(path)) throw new Error("not found");
    },
    readdirSync(path) {
      return Array.from(state.files.keys()).filter((file) => file.startsWith(path + "/")).map((file) => file.slice(path.length + 1));
    },
    mkdir({ dirPath, success }) {
      state.directories.add(dirPath);
      success({});
    },
    copyFile({ srcPath, destPath, success, fail }) {
      state.operations.push(["copy", srcPath, destPath]);
      state.copies += 1;
      state.files.set(destPath, "new image");
      if (state.failCopyAt === state.copies) fail({ errMsg: "disk full" });
      else success({});
    },
    unlink({ filePath, success, fail }) {
      state.operations.push(["unlink", filePath]);
      if (state.failUnlink === filePath) return fail({ errMsg: "access denied" });
      state.files.delete(filePath);
      success({});
    },
    getFileInfo({ filePath, success }) {
      state.operations.push(["fileInfo", filePath]);
      success({ size: 2048 });
    },
  };
  const api = {
    env: { USER_DATA_PATH: "wxfile://usr" },
    getFileSystemManager: () => fs,
    getStorageSync() {
      if (state.failLoad) throw new Error("storage unavailable");
      return state.settings;
    },
    setStorageSync(key, value) {
      state.operations.push(["save", key]);
      if (state.failSave) throw new Error("storage full");
      state.settings = structuredClone(value);
    },
    removeStorageSync(key) {
      state.operations.push(["clear", key]);
      if (state.failClear) throw new Error("storage unavailable");
      state.settings = undefined;
    },
    requirePrivacyAuthorize({ success, fail }) {
      state.operations.push(["privacy"]);
      if (state.failPrivacy) fail(state.failPrivacy);
      else success({});
    },
    chooseMedia({ success, fail, ...options }) {
      state.operations.push(["chooseMedia", options]);
      if (state.failChoose) fail(state.failChoose);
      else success({ tempFiles: state.selection });
    },
    chooseImage({ success, fail, ...options }) {
      state.operations.push(["chooseImage", options]);
      if (state.failChoose) fail(state.failChoose);
      else success(state.legacyResult || { tempFiles: state.selection.map((file) => ({ path: file.tempFilePath, size: file.size })) });
    },
  };
  const store = createPhotoStore(api);
  return { state, api, store };
}

test("game selects album images only after official privacy authorization, keeping old settings until save", async () => {
  const { state, store } = mockWechat();
  state.directories.delete(directory);
  const paths = await store.select(1);
  assert.deepEqual(state.operations.slice(0, 2), [
    ["privacy"],
    ["chooseMedia", { count: 1, mediaType: ["image"], sourceType: ["album"], sizeType: ["compressed"] }],
  ]);
  assert.equal(paths.length, 1);
  assert.ok(paths[0].startsWith(directory + "/photo-"));
  assert.ok(state.files.has(paths[0]));
  assert.deepEqual(store.load(), originalSettings());
  store.save({ mode: "six", single: null, faces: paths });
  assert.deepEqual(store.load(), { mode: "six", single: null, faces: [...paths, null, null, null, null, null] });
  assert.ok(state.files.has(oldPhoto));
});

test("game supports documented legacy picker results without small-program image APIs", async () => {
  const { state, api, store } = mockWechat();
  delete api.chooseMedia;
  state.legacyResult = { tempFilePaths: ["http://tmp/picked.png"] };
  const paths = await store.select(1);
  assert.ok(paths[0].endsWith(".png"));
  assert.deepEqual(state.operations[1], ["chooseImage", { count: 1, sourceType: ["album"], sizeType: ["compressed"] }]);
  assert.deepEqual(state.operations[2], ["fileInfo", "http://tmp/picked.png"]);
  state.legacyResult = undefined;
  assert.equal((await store.select(1)).length, 1);
});

test("game reports picker cancellation and privacy refusal without writing files", async () => {
  const { state, store } = mockWechat();
  state.failPrivacy = { errno: 104, errMsg: "privacy permission is not authorized" };
  await assert.rejects(store.select(1), (error) => error.cancelled === true);
  assert.deepEqual(state.operations, [["privacy"]]);
  state.failPrivacy = undefined;
  state.failChoose = { errMsg: "chooseMedia:fail cancel" };
  await assert.rejects(store.select(1), (error) => error.cancelled === true);
  assert.equal(state.copies, 0);
  assert.deepEqual(store.load(), originalSettings());
});

test("game distinguishes missing privacy declarations from a user cancellation", async () => {
  const { state, api, store } = mockWechat();
  for (const errno of [112, 1025, 1026]) {
    state.failPrivacy = { errno, errMsg: "api scope is not declared in the privacy agreement" };
    await assert.rejects(store.select(1), (error) => !error.cancelled && /隐私设置/.test(error.message));
  }
  delete api.requirePrivacyAuthorize;
  await assert.rejects(store.select(1), /更新微信/);
  assert.equal(state.copies, 0);
  assert.equal(state.operations.some(([operation]) => operation === "chooseMedia"), false);
});

test("six face selection requires all six images before creating persistent files", async () => {
  const { state, store } = mockWechat();
  state.selection = [chosen(0), chosen(1)];
  await assert.rejects(store.select(6), /一次选满 6 张/);
  assert.equal(state.copies, 0);
  state.selection = Array.from({ length: 6 }, (_, index) => chosen(index));
  const paths = await store.select(6);
  assert.equal(paths.length, 6);
  assert.equal(new Set(paths).size, 6);
});

test("game rejects invalid counts, remote paths, path traversal, non-images and oversized selections", async () => {
  const { state, store } = mockWechat();
  await assert.rejects(store.select(2), /1 张照片/);
  assert.deepEqual(state.operations, []);
  for (const selection of [
    [{ ...chosen(), tempFilePath: "https://example.com/photo.jpg" }],
    [{ ...chosen(), tempFilePath: "http://tmp.example.com/photo.jpg" }],
    [{ ...chosen(), tempFilePath: "wxfile://tmp/../photo.jpg" }],
    [{ ...chosen(), size: 20 * 1024 * 1024 + 1 }],
    [{ ...chosen(), size: 0 }],
    [{ ...chosen(), fileType: "video" }],
  ]) {
    state.selection = selection;
    await assert.rejects(store.select(1));
  }
  assert.equal(state.copies, 0);
});

test("failed six-photo batch removes partial new copies while keeping existing photos and metadata", async () => {
  const { state, store } = mockWechat();
  state.selection = Array.from({ length: 6 }, (_, index) => chosen(index));
  state.failCopyAt = 2;
  await assert.rejects(store.select(6), /照片保存失败/);
  assert.deepEqual(Array.from(state.files.keys()), [oldPhoto]);
  assert.equal(state.operations.filter(([name]) => name === "unlink").length, 2);
  assert.deepEqual(store.load(), originalSettings());
});

test("failed metadata commit permits rollback of prepared files while preserving the old image", async () => {
  const { state, store } = mockWechat();
  const prepared = await store.select(1);
  state.failSave = true;
  assert.throws(() => store.save({ mode: "single", single: prepared[0], faces: [] }), /storage full/);
  await store.remove(prepared);
  assert.deepEqual(Array.from(state.files.keys()), [oldPhoto]);
  assert.deepEqual(store.load(), originalSettings());
});

test("game restores only existing owned photo files and tolerates damaged or unavailable storage", () => {
  const { state, store } = mockWechat();
  state.settings = {
    mode: "six",
    single: "https://example.com/photo.jpg",
    faces: [oldPhoto, `${directory}/../photo-old-1-a.jpg`, `${directory}/photo-missing-1-a.jpg`, `${directory}/notes.jpg`, "wxfile://usr/outside.jpg"],
  };
  assert.deepEqual(store.load(), { mode: "six", single: null, faces: [oldPhoto, null, null, null, null, null] });
  state.settings = { mode: "single", single: `${directory}/photo-missing-1-a.jpg` };
  assert.deepEqual(store.load(), store.defaultSettings());
  state.settings = "broken";
  assert.deepEqual(store.load(), store.defaultSettings());
  state.failLoad = true;
  assert.deepEqual(store.load(), store.defaultSettings());
  const defaults = store.defaultSettings();
  defaults.faces[0] = oldPhoto;
  assert.equal(store.defaultSettings().faces[0], null);
});

test("clear commits empty metadata before deletion, removes orphaned photos and never touches outside files", async () => {
  const { state, store } = mockWechat();
  await store.select(1);
  const unrelated = `${directory}/notes.jpg`;
  const outside = "wxfile://usr/outside.jpg";
  state.files.set(unrelated, "unrelated");
  state.files.set(outside, "outside");
  state.failClear = true;
  await assert.rejects(store.clear(), /storage unavailable/);
  assert.ok(state.files.has(oldPhoto));
  state.failClear = false;
  state.operations.length = 0;
  await store.clear();
  assert.deepEqual(store.load(), store.defaultSettings());
  assert.equal(state.operations[0][0], "clear");
  assert.deepEqual(Array.from(state.files.keys()), [unrelated, outside]);
  await store.remove([unrelated, outside, `${directory}/../photo-old-1-a.jpg`]);
  assert.deepEqual(Array.from(state.files.keys()), [unrelated, outside]);
});
