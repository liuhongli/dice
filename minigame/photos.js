const SETTINGS_KEY = "dice-party-minigame-photos-v1";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const OWNED_NAME = /^photo-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.(?:jpg|png|gif|bmp|webp|avif|heic|heif|tiff)$/;

function defaultSettings() {
  return { mode: "default", single: null, faces: Array(6).fill(null) };
}

function callApi(target, method, options) {
  return new Promise((resolve, reject) => {
    target[method](Object.assign({}, options, { success: resolve, fail: reject }));
  });
}

function localPath(path) {
  if (typeof path !== "string" || !path || /[\\\r\n]/.test(path)) return false;
  if (path.split("/").includes("..")) return false;
  // Developer tools use http://tmp and http://usr as local virtual filesystems.
  return /^wxfile:\/\//.test(path) || /^http:\/\/(?:tmp|usr)\//.test(path) || /^\/(?!\/)/.test(path);
}

function selectionError(error, privacy) {
  const detail = String((error && (error.errMsg || error.message)) || "");
  const code = error && error.errno;
  if ([112, 1025, 1026].includes(code) || /privacy.*(?:declared|announce|implement)|privacy pop-up/i.test(detail)) {
    return new Error("照片功能的隐私设置尚未完成，请联系开发者完善后再试。");
  }
  if (/cancel/i.test(detail) || (privacy && (code === 104 || /deny|denied|disagree|not authorized/i.test(detail)))) {
    const cancelled = new Error("已取消选择照片。");
    cancelled.cancelled = true;
    return cancelled;
  }
  if (/auth|permission|deny|denied/i.test(detail)) {
    return new Error("暂时无法打开相册，请检查微信的照片权限后重试。");
  }
  return new Error(privacy ? "照片授权未完成，请稍后重试。" : "相册没有打开，请稍后重试。");
}

function createPhotoStore(wxApi) {
  const root = wxApi && wxApi.env && wxApi.env.USER_DATA_PATH;
  if (!root || typeof wxApi.getFileSystemManager !== "function") {
    throw new Error("当前微信暂时无法保存照片，请更新微信后重试。");
  }
  const directory = root.replace(/\/$/, "") + "/dice-party-game-photos";
  const fs = wxApi.getFileSystemManager();
  let sequence = 0;

  function owned(path) {
    return typeof path === "string" && path.startsWith(directory + "/") && OWNED_NAME.test(path.slice(directory.length + 1));
  }

  function exists(path) {
    try {
      fs.accessSync(path);
      return true;
    } catch (_) {
      return false;
    }
  }

  function photo(path) {
    return owned(path) && exists(path) ? path : null;
  }

  function normalize(value) {
    const settings = defaultSettings();
    if (!value || typeof value !== "object" || Array.isArray(value)) return settings;
    settings.single = photo(value.single);
    settings.faces = Array.from({ length: 6 }, (_, index) => photo(Array.isArray(value.faces) ? value.faces[index] : null));
    if (value.mode === "single" && settings.single) settings.mode = "single";
    if (value.mode === "six" && settings.faces.some(Boolean)) settings.mode = "six";
    return settings;
  }

  function load() {
    try {
      return normalize(wxApi.getStorageSync(SETTINGS_KEY));
    } catch (_) {
      return defaultSettings();
    }
  }

  function save(settings) {
    // The caller only retires old files after this synchronous write succeeds.
    wxApi.setStorageSync(SETTINGS_KEY, normalize(settings));
  }

  async function remove(paths) {
    let failed = false;
    for (const path of new Set(Array.isArray(paths) ? paths.filter(owned) : [])) {
      if (!exists(path)) continue;
      try {
        await callApi(fs, "unlink", { filePath: path });
      } catch (_) {
        failed = true;
      }
    }
    if (failed) throw new Error("部分旧照片暂时无法清理，请稍后重试。");
  }

  async function ensureDirectory() {
    if (exists(directory)) return;
    try {
      await callApi(fs, "mkdir", { dirPath: directory, recursive: true });
    } catch (error) {
      if (!exists(directory)) throw error;
    }
  }

  function freshPath(source) {
    const suffix = /\.(jpg|jpeg|png|gif|bmp|webp|avif|heic|heif|tiff)$/i.exec(source);
    const extension = suffix ? suffix[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
    for (let attempt = 0; attempt < 32; attempt += 1) {
      sequence += 1;
      const token = Math.random().toString(36).slice(2, 10) || "0";
      const path = `${directory}/photo-${Date.now().toString(36)}-${sequence.toString(36)}-${token}.${extension}`;
      if (!exists(path)) return path;
    }
    throw new Error("暂时无法创建照片文件，请重试。");
  }

  async function pick(count) {
    if (typeof wxApi.requirePrivacyAuthorize !== "function") {
      throw new Error("请更新微信后使用照片背景，普通掷骰子不受影响。");
    }
    try {
      // Uses the official game privacy dialog. Do not register a fake custom consent flow.
      await callApi(wxApi, "requirePrivacyAuthorize", {});
    } catch (error) {
      throw selectionError(error, true);
    }
    try {
      if (typeof wxApi.chooseMedia === "function") {
        const result = await callApi(wxApi, "chooseMedia", {
          count,
          mediaType: ["image"],
          sourceType: ["album"],
          sizeType: ["compressed"],
        });
        return result && result.tempFiles;
      }
      if (typeof wxApi.chooseImage === "function") {
        const result = await callApi(wxApi, "chooseImage", {
          count,
          sourceType: ["album"],
          sizeType: ["compressed"],
        });
        if (!result) return [];
        return Array.isArray(result.tempFiles)
          ? result.tempFiles.map((file) => ({ tempFilePath: file.path, size: file.size }))
          : (result.tempFilePaths || []).map((path) => ({ tempFilePath: path }));
      }
    } catch (error) {
      throw selectionError(error, false);
    }
    throw new Error("当前微信暂时无法选择照片，请更新微信后重试。");
  }

  async function select(count) {
    if (count !== 1 && count !== 6) throw new Error("请选择 1 张照片，或一次选择 6 张照片。");
    const files = await pick(count);
    if (!Array.isArray(files) || files.length !== count) {
      throw new Error(count === 6 ? "六个面需要 6 张照片，请重新一次选满 6 张。" : "请选择 1 张照片。");
    }
    // Validate the whole batch before creating any persistent files.
    for (const file of files) {
      if (!file || !localPath(file.tempFilePath) || (file.fileType && file.fileType !== "image")) {
        throw new Error("没有读到照片，请重新从相册选择。");
      }
      let size = file.size;
      if (!Number.isFinite(size) && typeof fs.getFileInfo === "function") {
        try {
          const info = await callApi(fs, "getFileInfo", { filePath: file.tempFilePath });
          size = info.size;
        } catch (_) {
          throw new Error("没有读到照片，请重新从相册选择。");
        }
      }
      if (!Number.isFinite(size) || size <= 0) throw new Error("没有读到照片，请重新从相册选择。");
      if (size > MAX_FILE_BYTES) throw new Error("这张照片超过 20 MB，请选择一张小一点的照片。");
    }
    const created = [];
    try {
      await ensureDirectory();
      for (const file of files) {
        const destination = freshPath(file.tempFilePath);
        // Register before copy: failed copies may still leave partial files.
        created.push(destination);
        await callApi(fs, "copyFile", { srcPath: file.tempFilePath, destPath: destination });
      }
      return created;
    } catch (_) {
      const failure = new Error("照片保存失败，请检查存储空间后重试。");
      try {
        await remove(created);
      } catch (cleanupError) {
        failure.cleanupError = cleanupError;
      }
      throw failure;
    }
  }

  async function clear() {
    // Preserve existing photos if storage fails before the settings are cleared.
    wxApi.removeStorageSync(SETTINGS_KEY);
    if (!exists(directory)) return;
    await remove(fs.readdirSync(directory).map((name) => directory + "/" + name));
  }

  return { defaultSettings, load, save, select, remove, clear };
}

module.exports = { createPhotoStore };
