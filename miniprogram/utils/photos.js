const SETTINGS_KEY = "dice-party-photo-settings-v1";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PHOTO_EDGE = 640;
const OWNED_NAME =
  /^photo-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.(?:jpg|png|gif|bmp|webp|avif|heic|heif|tiff)$/;
const PHOTO_TYPES = new Set([
  "jpeg",
  "jpg",
  "png",
  "gif",
  "bmp",
  "webp",
  "avif",
  "heic",
  "heif",
  "tiff",
]);

function defaultSettings() {
  return { mode: "default", single: null, faces: Array(6).fill(null) };
}

function callApi(target, method, options) {
  return new Promise((resolve, reject) => {
    target[method](
      Object.assign({}, options, { success: resolve, fail: reject }),
    );
  });
}

function isLocalPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    /[\r\n]/.test(path)
  )
    return false;
  if (path.split("/").includes("..")) return false;
  // http://tmp is the developer tools' local filesystem, not a network host.
  return (
    /^wxfile:\/\//.test(path) ||
    /^http:\/\/(?:tmp|usr)\//.test(path) ||
    /^\/(?!\/)/.test(path)
  );
}

function createPhotoStore(wxApi) {
  const root = wxApi && wxApi.env && wxApi.env.USER_DATA_PATH;
  if (!root || typeof wxApi.getFileSystemManager !== "function") {
    throw new Error("当前微信暂时无法保存照片，请更新微信后重试。");
  }
  const directory = root.replace(/\/$/, "") + "/dice-party-photos";
  const fs = wxApi.getFileSystemManager();
  let sequence = 0;

  function isOwned(path) {
    if (typeof path !== "string" || !path.startsWith(directory + "/"))
      return false;
    return OWNED_NAME.test(path.slice(directory.length + 1));
  }

  function exists(path) {
    try {
      fs.accessSync(path);
      return true;
    } catch (_) {
      return false;
    }
  }

  function validPhoto(path) {
    return isOwned(path) && exists(path) ? path : null;
  }

  function normalizeSettings(value) {
    const settings = defaultSettings();
    if (!value || typeof value !== "object" || Array.isArray(value))
      return settings;
    settings.single = validPhoto(value.single);
    settings.faces = Array.from({ length: 6 }, (_, index) =>
      validPhoto(Array.isArray(value.faces) ? value.faces[index] : null),
    );
    if (value.mode === "single" && settings.single) settings.mode = "single";
    if (value.mode === "six" && settings.faces.some(Boolean))
      settings.mode = "six";
    return settings;
  }

  function load() {
    return normalizeSettings(wxApi.getStorageSync(SETTINGS_KEY));
  }

  function save(settings) {
    // Keep the old settings and files intact when synchronous storage fails.
    wxApi.setStorageSync(SETTINGS_KEY, normalizeSettings(settings));
  }

  async function remove(paths) {
    const errors = [];
    const owned = Array.from(
      new Set(Array.isArray(paths) ? paths.filter(isOwned) : []),
    );
    for (const path of owned) {
      if (!exists(path)) continue;
      try {
        await callApi(fs, "unlink", { filePath: path });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new Error("部分旧照片暂时无法清理，请稍后重试。");
  }

  async function ensureDirectory() {
    if (exists(directory)) return;
    try {
      await callApi(fs, "mkdir", { dirPath: directory, recursive: true });
    } catch (error) {
      if (!exists(directory)) throw error;
    }
  }

  function freshPath(extension) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      sequence += 1;
      const token = Math.random().toString(36).slice(2, 10) || "0";
      const path = `${directory}/photo-${Date.now().toString(36)}-${sequence.toString(36)}-${token}.${extension}`;
      if (!exists(path)) return path;
    }
    throw new Error("暂时无法创建照片文件，请重试。");
  }

  async function prepare(files) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 6) {
      throw new Error("每次请选择 1 到 6 张照片。");
    }
    for (const file of files) {
      if (
        !file ||
        !isLocalPath(file.tempFilePath) ||
        !Number.isFinite(file.size) ||
        file.size <= 0
      ) {
        throw new Error("没有读到照片，请重新从相册选择。");
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new Error("这张照片超过 20 MB，请选择一张小一点的照片。");
      }
    }

    const created = [];
    try {
      await ensureDirectory();
      for (const file of files) {
        const info = await callApi(wxApi, "getImageInfo", {
          src: file.tempFilePath,
        });
        if (
          !Number.isFinite(info.width) ||
          !Number.isFinite(info.height) ||
          info.width <= 0 ||
          info.height <= 0 ||
          !PHOTO_TYPES.has(info.type)
        ) {
          throw new Error("无法打开这张照片，请尝试另一张 JPG 或 PNG 图片。");
        }
        const scale = Math.min(
          1,
          PHOTO_EDGE / Math.max(info.width, info.height),
        );
        const compressed = await callApi(wxApi, "compressImage", {
          src: file.tempFilePath,
          quality: 82,
          compressedWidth: Math.max(1, Math.round(info.width * scale)),
          compressedHeight: Math.max(1, Math.round(info.height * scale)),
        });
        if (!compressed || !isLocalPath(compressed.tempFilePath)) {
          throw new Error("照片处理失败，请重新选择一张照片。");
        }
        const extension = info.type === "jpeg" ? "jpg" : info.type;
        const destination = freshPath(extension);
        // Register the destination first so a partially failed copy is cleaned.
        created.push(destination);
        await callApi(fs, "copyFile", {
          srcPath: compressed.tempFilePath,
          destPath: destination,
        });
      }
      return created;
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("照片保存失败，请检查存储空间后重试。");
      try {
        await remove(created);
      } catch (cleanupError) {
        failure.cleanupError = cleanupError;
      }
      throw failure;
    }
  }

  async function clear() {
    // Fail before touching files if the saved settings cannot be removed.
    wxApi.removeStorageSync(SETTINGS_KEY);
    if (!exists(directory)) return;
    const paths = fs
      .readdirSync(directory)
      .map((name) => directory + "/" + name);
    await remove(paths);
  }

  return { defaultSettings, load, save, prepare, remove, clear };
}

module.exports = { createPhotoStore };
