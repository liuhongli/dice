import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPhotoStore } = require("../miniprogram/utils/photos.js");
const directory = "wxfile://usr/dice-party-photos";
const oldPhoto = `${directory}/photo-old-1-a.jpg`;

function mockWechat() {
  const state = {
    settings: undefined,
    files: new Map([[oldPhoto, "old image"]]),
    directories: new Set(["wxfile://usr", directory]),
    operations: [],
    infoFailures: new Set(),
    copies: 0,
  };
  const fs = {
    accessSync(path) {
      if (!state.files.has(path) && !state.directories.has(path))
        throw new Error("not found");
    },
    readdirSync(path) {
      return Array.from(state.files.keys())
        .filter((file) => file.startsWith(path + "/"))
        .map((file) => file.slice(path.length + 1));
    },
    mkdir({ dirPath, success }) {
      state.directories.add(dirPath);
      success({});
    },
    copyFile({ srcPath, destPath, success, fail }) {
      state.operations.push(["copy", srcPath, destPath]);
      state.copies += 1;
      state.files.set(destPath, state.files.get(srcPath));
      if (state.failCopyAt === state.copies) fail({ errMsg: "disk full" });
      else success({});
    },
    unlink({ filePath, success, fail }) {
      state.operations.push(["unlink", filePath]);
      if (state.failUnlink === filePath) {
        fail({ errMsg: "access denied" });
        return;
      }
      state.files.delete(filePath);
      success({});
    },
  };
  const api = {
    env: { USER_DATA_PATH: "wxfile://usr" },
    getFileSystemManager: () => fs,
    getStorageSync: () => state.settings,
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
    getImageInfo({ src, success, fail }) {
      state.operations.push(["info", src]);
      if (state.infoFailures.has(src)) fail({ errMsg: "invalid image" });
      else success({ width: 1200, height: 800, type: "jpeg", path: src });
    },
    compressImage({
      src,
      quality,
      compressedWidth,
      compressedHeight,
      success,
    }) {
      state.operations.push([
        "compress",
        src,
        quality,
        compressedWidth,
        compressedHeight,
      ]);
      const tempFilePath = src + "-compressed.jpg";
      state.files.set(tempFilePath, "compressed image");
      success({ tempFilePath });
    },
  };
  return { state, api, store: createPhotoStore(api) };
}

function photo(name = "a") {
  return { tempFilePath: `wxfile://tmp/${name}.jpg`, size: 2000 };
}

test("loads only existing owned photo files and never trusts remote or traversing stored paths", () => {
  const { state, store } = mockWechat();
  state.settings = {
    mode: "six",
    single: "https://example.com/private.jpg",
    faces: [
      oldPhoto,
      `${directory}/../photo-old-1-a.jpg`,
      `${directory}/photo-missing-1-a.jpg`,
      `${directory}/notes.jpg`,
      "wxfile://usr/another.jpg",
    ],
  };
  assert.deepEqual(store.load(), {
    mode: "six",
    single: null,
    faces: [oldPhoto, null, null, null, null, null],
  });
  state.settings = {
    mode: "single",
    single: `${directory}/photo-missing-1-a.jpg`,
  };
  assert.deepEqual(store.load(), store.defaultSettings());
  const settings = store.defaultSettings();
  settings.faces[0] = oldPhoto;
  assert.equal(store.defaultSettings().faces[0], null);
});

test("prepares compressed persistent photos without modifying current saved settings", async () => {
  const { state, store } = mockWechat();
  const oldSettings = {
    mode: "single",
    single: oldPhoto,
    faces: Array(6).fill(null),
  };
  state.settings = oldSettings;
  state.directories.delete(directory);
  const prepared = await store.prepare([photo("a"), photo("b")]);
  assert.equal(new Set(prepared).size, 2);
  assert.ok(
    prepared.every(
      (path) => path.startsWith(directory + "/photo-") && state.files.has(path),
    ),
  );
  assert.deepEqual(
    state.operations
      .filter(([name]) => name === "compress")
      .map((op) => op.slice(2)),
    [
      [82, 640, 427],
      [82, 640, 427],
    ],
  );
  assert.equal(state.settings, oldSettings);
  assert.equal(state.files.get(oldPhoto), "old image");
  store.save({ mode: "six", single: null, faces: prepared });
  assert.deepEqual(store.load().faces, [...prepared, null, null, null, null]);
});

test("failed batches clean new files including partial copies and preserve existing photos", async () => {
  const { state, store } = mockWechat();
  state.settings = {
    mode: "single",
    single: oldPhoto,
    faces: Array(6).fill(null),
  };
  state.failCopyAt = 2;
  await assert.rejects(store.prepare([photo("a"), photo("b")]), /照片保存失败/);
  const ownedFiles = Array.from(state.files.keys()).filter((path) =>
    path.startsWith(directory + "/"),
  );
  assert.deepEqual(ownedFiles, [oldPhoto]);
  assert.equal(store.load().single, oldPhoto);
  assert.equal(
    state.operations.filter(([name]) => name === "unlink").length,
    2,
  );
});

test("a late image decoding failure rolls back earlier prepared photos", async () => {
  const { state, store } = mockWechat();
  state.infoFailures.add(photo("broken").tempFilePath);
  await assert.rejects(
    store.prepare([photo("a"), photo("broken")]),
    /照片保存失败/,
  );
  assert.deepEqual(
    Array.from(state.files.keys()).filter((path) =>
      path.startsWith(directory + "/"),
    ),
    [oldPhoto],
  );
});

test("invalid selections are rejected before any image access or filesystem mutation", async () => {
  const { state, store } = mockWechat();
  for (const selection of [
    [],
    Array(7).fill(photo()),
    [{ ...photo(), size: 20 * 1024 * 1024 + 1 }],
    [{ ...photo(), tempFilePath: "https://example.com/a.jpg" }],
    [{ ...photo(), tempFilePath: "wxfile://tmp/../a.jpg" }],
    [{ ...photo(), size: 0 }],
  ]) {
    await assert.rejects(store.prepare(selection));
  }
  assert.deepEqual(state.operations, []);
});

test("developer tools virtual local paths are supported without admitting remote URLs", async () => {
  const { store } = mockWechat();
  assert.equal(
    (
      await store.prepare([
        { tempFilePath: "http://tmp/chosen.jpg", size: 1000 },
      ])
    ).length,
    1,
  );
  await assert.rejects(
    store.prepare([
      { tempFilePath: "http://tmp.example.com/chosen.jpg", size: 1000 },
    ]),
  );
});

test("storage failures preserve old photo settings and cleanup is confined to owned paths", async () => {
  const { state, store } = mockWechat();
  state.settings = {
    mode: "single",
    single: oldPhoto,
    faces: Array(6).fill(null),
  };
  const prepared = await store.prepare([photo()]);
  state.failSave = true;
  assert.throws(
    () => store.save({ mode: "single", single: prepared[0], faces: [] }),
    /storage full/,
  );
  assert.equal(store.load().single, oldPhoto);
  const unrelated = `${directory}/notes.jpg`;
  const outside = "wxfile://usr/another-file.jpg";
  state.files.set(unrelated, "unrelated");
  state.files.set(outside, "outside");
  await store.remove([
    ...prepared,
    ...prepared,
    unrelated,
    outside,
    `${directory}/../photo-old-1-a.jpg`,
  ]);
  assert.equal(state.files.get(oldPhoto), "old image");
  assert.equal(state.files.get(unrelated), "unrelated");
  assert.equal(state.files.get(outside), "outside");
  assert.equal(
    state.operations.filter(([name]) => name === "unlink").length,
    1,
  );
});

test("clear removes saved settings before owned photos and preserves unrelated files", async () => {
  const { state, store } = mockWechat();
  state.settings = {
    mode: "single",
    single: oldPhoto,
    faces: Array(6).fill(null),
  };
  state.files.set(`${directory}/notes.jpg`, "unrelated");
  state.failClear = true;
  await assert.rejects(store.clear(), /storage unavailable/);
  assert.equal(state.files.get(oldPhoto), "old image");
  state.failClear = false;
  state.operations.length = 0;
  await store.clear();
  assert.deepEqual(store.load(), store.defaultSettings());
  assert.equal(state.files.has(oldPhoto), false);
  assert.equal(state.files.get(`${directory}/notes.jpg`), "unrelated");
  assert.deepEqual(
    state.operations.map(([name]) => name),
    ["clear", "unlink"],
  );
});
