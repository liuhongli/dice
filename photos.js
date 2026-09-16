const DATABASE_NAME = "dice-party-photos";
const STORE_NAME = "settings";
const SETTINGS_KEY = "dice-background";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_LENGTH = 1024 * 1024;
const PHOTO_SIZE = 512;

const RASTER_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const RASTER_EXTENSION = /\.(?:jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;

function defaultSettings() {
  return { mode: "default", single: null, faces: Array(6).fill(null) };
}

function validPhoto(value) {
  // Only our raster JPEG format can reach a CSS background; never accept URLs,
  // SVG, arbitrary data URIs, or excessively large persisted values.
  return (
    typeof value === "string" &&
    value.length >= 128 &&
    value.length <= MAX_PHOTO_LENGTH &&
    /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

function normalizeSettings(value) {
  const settings = defaultSettings();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return settings;

  settings.single = validPhoto(value.single) ? value.single : null;
  settings.faces = Array.from({ length: 6 }, (_, index) => {
    const photo = Array.isArray(value.faces) ? value.faces[index] : null;
    return validPhoto(photo) ? photo : null;
  });
  if (value.mode === "single" && settings.single) settings.mode = "single";
  if (value.mode === "six" && settings.faces.some(Boolean))
    settings.mode = "six";
  return settings;
}

function validateFile(file) {
  if (!(file instanceof Blob) || !file.size) {
    throw new Error("没有读到照片，请重新选择一张图片。");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("这张照片超过 20 MB，请选择一张小一点的照片。");
  }

  const type = file.type.toLowerCase();
  const name = typeof file.name === "string" ? file.name : "";
  if (type.includes("svg") || /\.svgz?$/i.test(name)) {
    throw new Error(
      "请选择 JPG、PNG、HEIC 或其他常见格式的照片，暂不支持 SVG。",
    );
  }
  const hasGenericType = !type || type === "application/octet-stream";
  if (
    !RASTER_TYPES.has(type) &&
    !(hasGenericType && RASTER_EXTENSION.test(name))
  ) {
    throw new Error(
      "请选择 JPG、PNG、HEIC、HEIF、WebP、AVIF、GIF 或 BMP 格式的照片。",
    );
  }
}

/** Center-crop a local photo into a small, opaque JPEG without uploading it. */
export async function preparePhoto(file) {
  validateFile(file);
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  let decodeTimeout;

  try {
    await new Promise((resolve, reject) => {
      decodeTimeout = setTimeout(() => {
        reject(
          new Error(
            "照片读取超时，请试试小一点的 JPG 或 PNG 图片；HEIC / HEIF 照片也可先转换格式。",
          ),
        );
      }, 15000);
      image.onload = resolve;
      image.onerror = () =>
        reject(
          new Error(
            "无法打开这张照片，请尝试另一张 JPG 或 PNG 图片；HEIC / HEIF 照片请先转换格式。",
          ),
        );
      image.src = objectUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height)
      throw new Error("这张照片没有可用的画面，请重新选择。");

    // Modern browsers apply the photo's EXIF orientation when decoding Image.
    const cropSize = Math.min(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器暂时无法处理照片，请刷新后再试。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (width - cropSize) / 2,
      (height - cropSize) / 2,
      cropSize,
      cropSize,
      0,
      0,
      PHOTO_SIZE,
      PHOTO_SIZE,
    );
    const photo = canvas.toDataURL("image/jpeg", 0.85);
    if (!validPhoto(photo))
      throw new Error("照片处理失败，请换一张 JPG 或 PNG 图片试试。");
    return photo;
  } finally {
    clearTimeout(decodeTimeout);
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(objectUrl);
  }
}

function storageError(error) {
  return new Error(
    error?.name === "QuotaExceededError"
      ? "浏览器的照片存储空间不足，本次设置仍可使用，但刷新后可能无法保留。"
      : "浏览器暂时无法保存或读取照片，本次设置仍可使用，但刷新后可能无法保留。",
    { cause: error },
  );
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      finish(
        new Error(
          "照片存储暂时无法打开，请关闭其他骰子页面后再试；本次设置仍可使用。",
        ),
      );
    }, 3000);

    function finish(error, database) {
      if (finished) {
        database?.close();
        return;
      }
      finished = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(database);
    }

    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (finished) {
          request.transaction?.abort();
          return;
        }
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        finish(null, database);
      };
      request.onerror = () => finish(storageError(request.error));
      // A blocked upgrade is allowed a short grace period. A late successful
      // open is closed by finish() after the timeout, avoiding leaked handles.
      request.onblocked = () => {};
    } catch (error) {
      finish(storageError(error));
    }
  });
}

async function accessSettings(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let transaction;
      let request;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        request = operation(transaction.objectStore(STORE_NAME));
      } catch (error) {
        reject(storageError(error));
        return;
      }
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () =>
        reject(storageError(transaction.error || request.error));
      transaction.onabort = () =>
        reject(storageError(transaction.error || request.error));
    });
  } finally {
    database.close();
  }
}

/** Missing or invalid stored settings safely return standard dice. */
export async function loadPhotoSettings() {
  return normalizeSettings(
    await accessSettings("readonly", (store) => store.get(SETTINGS_KEY)),
  );
}

export async function savePhotoSettings(settings) {
  await accessSettings("readwrite", (store) =>
    store.put(normalizeSettings(settings), SETTINGS_KEY),
  );
}

export async function clearPhotoSettings() {
  await accessSettings("readwrite", (store) => store.delete(SETTINGS_KEY));
}
