import test from "node:test";
import assert from "node:assert/strict";
import { preparePhoto } from "../photos.js";

function photoFile(name, type, content = "photo") {
  const file = new Blob([content], { type });
  Object.defineProperty(file, "name", { value: name });
  return file;
}

function mockPhotoBrowser(
  t,
  {
    width = 1200,
    height = 800,
    decodeError = false,
    decodeHang = false,
    canvasError = false,
  } = {},
) {
  const calls = { revoked: [], draws: [], fills: [] };
  const jpeg = `data:image/jpeg;base64,/9j/${"A".repeat(128)}==`;
  t.mock.method(URL, "createObjectURL", () => "blob:local-photo");
  t.mock.method(URL, "revokeObjectURL", (value) => calls.revoked.push(value));
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  globalThis.Image = class {
    naturalWidth = width;
    naturalHeight = height;
    set src(value) {
      assert.equal(value, "blob:local-photo");
      if (!decodeHang)
        queueMicrotask(() => (decodeError ? this.onerror() : this.onload()));
    }
  };
  const context = {
    fillRect: (...args) => calls.fills.push(args),
    drawImage: (image, ...args) => calls.draws.push(args),
  };
  const canvas = {
    getContext: () => (canvasError ? null : context),
    toDataURL(type, quality) {
      assert.equal(type, "image/jpeg");
      assert.equal(quality, 0.85);
      return jpeg;
    },
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return canvas;
    },
  };
  t.after(() => {
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  return { calls, jpeg, canvas, context };
}

test("rejects unsupported and oversized uploads before trying to decode them", async () => {
  await assert.rejects(
    preparePhoto(photoFile("drawing.svg", "image/svg+xml")),
    /不支持 SVG/,
  );
  await assert.rejects(
    preparePhoto(photoFile("hidden.svg", "image/png")),
    /不支持 SVG/,
  );
  await assert.rejects(
    preparePhoto(photoFile("notes.txt", "text/plain")),
    /请选择.*格式/,
  );
  await assert.rejects(preparePhoto(new Blob([])), /没有读到照片/);
  await assert.rejects(
    preparePhoto(
      photoFile("huge.jpg", "image/jpeg", new Uint8Array(20 * 1024 * 1024 + 1)),
    ),
    /超过 20 MB/,
  );
});

test("landscape photos are center-cropped, flattened onto white, and reduced to 512 pixels", async (t) => {
  const { calls, jpeg, canvas, context } = mockPhotoBrowser(t);
  assert.equal(await preparePhoto(photoFile("family.jpg", "image/jpeg")), jpeg);
  assert.deepEqual(calls.draws, [[200, 0, 800, 800, 0, 0, 512, 512]]);
  assert.deepEqual(calls.fills, [[0, 0, 512, 512]]);
  assert.equal(context.fillStyle, "#ffffff");
  assert.equal(canvas.width, 512);
  assert.equal(canvas.height, 512);
  assert.deepEqual(calls.revoked, ["blob:local-photo"]);
});

test("portrait photos with no MIME metadata can use a known raster extension", async (t) => {
  const { calls } = mockPhotoBrowser(t, { width: 600, height: 1000 });
  await preparePhoto(photoFile("portrait.PNG", ""));
  assert.deepEqual(calls.draws, [[0, 200, 600, 600, 0, 0, 512, 512]]);
  assert.deepEqual(calls.revoked, ["blob:local-photo"]);
});

test("decode failures explain what to try and release the object URL", async (t) => {
  const { calls } = mockPhotoBrowser(t, { decodeError: true });
  await assert.rejects(
    preparePhoto(photoFile("broken.jpg", "image/jpeg")),
    /JPG 或 PNG.*HEIC/,
  );
  assert.deepEqual(calls.revoked, ["blob:local-photo"]);
});

test("HEIC and HEIF photos can use native browser decoding when available", async (t) => {
  const { jpeg } = mockPhotoBrowser(t);
  assert.equal(
    await preparePhoto(photoFile("portrait.heic", "image/heic")),
    jpeg,
  );
  assert.equal(await preparePhoto(photoFile("portrait.heif", "")), jpeg);
});

test("unsupported HEIC decoding suggests conversion and releases the object URL", async (t) => {
  const { calls } = mockPhotoBrowser(t, { decodeError: true });
  await assert.rejects(
    preparePhoto(photoFile("portrait.heic", "image/heic")),
    /JPG 或 PNG.*HEIC.*转换格式/,
  );
  assert.deepEqual(calls.revoked, ["blob:local-photo"]);
});

test("stalled decoders time out and release their resources", async (t) => {
  const { calls } = mockPhotoBrowser(t, { decodeHang: true });
  const cleared = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    assert.equal(delay, 15000);
    queueMicrotask(callback);
    return 123;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => cleared.push(timer));
  await assert.rejects(
    preparePhoto(photoFile("stalled.png", "image/png")),
    /照片读取超时/,
  );
  assert.deepEqual(calls.revoked, ["blob:local-photo"]);
  assert.deepEqual(cleared, [123]);
});

test("canvas failures also release the object URL", async (t) => {
  const { calls } = mockPhotoBrowser(t, { canvasError: true });
  await assert.rejects(
    preparePhoto(photoFile("family.webp", "image/webp")),
    /无法处理照片/,
  );
  assert.deepEqual(calls.revoked, ["blob:local-photo"]);
});
