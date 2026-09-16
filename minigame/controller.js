const { normalizeDiceCount, rollDice } = require("./dice.js");

const SETTINGS_KEY = "dice-party-game-v1";
const ROLL_DURATION = 2000;
const PHOTO_HINT = "照片只保存在这台设备上，不会上传。";

function createGame({
  wxApi,
  photoStore,
  invalidate = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  randomRoll = rollDice,
}) {
  let saved = {};
  try {
    saved = wxApi.getStorageSync(SETTINGS_KEY) || {};
  } catch (_) {}
  const count = normalizeDiceCount(saved.count);
  const state = {
    count,
    values: Array.from({ length: count }, (_, i) => ((i + 2) % 6) + 1),
    rolling: false,
    rollStartedAt: 0,
    rollDuration: ROLL_DURATION,
    resultReady: false,
    soundEnabled: saved.soundEnabled !== false,
    history: Array.isArray(saved.history)
      ? saved.history.filter((entry) => entry && Number.isFinite(entry.time) &&
          entry.time > 0 && Array.isArray(entry.values) &&
          entry.values.length >= 1 && entry.values.length <= 6 &&
          entry.values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)).slice(0, 8)
      : [],
    photoOpen: false,
    photos: photoStore.defaultSettings(),
    photoBusy: false,
    photoStatus: PHOTO_HINT,
    scrollY: 0,
    celebrateAt: null,
  };
  try {
    state.photos = photoStore.load();
  } catch (_) {
    state.photoStatus = "暂时无法读取照片，可以重新从相册选择。";
  }
  let alive = true;
  let epoch = 0;
  let rollTimer;
  let beforeRoll;
  const audio = {};
  let audioErrorShown = false;
  function audioError(name, error) {
    console.warn(`[dice audio] ${name}`, error);
    if (alive && state.soundEnabled && !audioErrorShown) {
      audioErrorShown = true;
      toast("音效暂时无法播放，请重新打开小游戏");
    }
  }
  function configureAudio() {
    try {
      if (typeof wxApi.setInnerAudioOption === "function") {
        // Current iOS clients use the global option; the in-game switch
        // remains the user's control over whether effects are played.
        wxApi.setInnerAudioOption({
          obeyMuteSwitch: false,
          fail: (error) => console.warn("[dice audio] options", error),
        });
      }
    } catch (error) { console.warn("[dice audio] options", error); }
  }
  configureAudio();
  for (const name of ["rolling", "landing"]) {
    try {
      if (typeof wxApi.createInnerAudioContext !== "function") break;
      const player = wxApi.createInnerAudioContext();
      if (player.onError) player.onError((error) => audioError(name, error));
      player.autoplay = false;
      player.loop = false;
      player.volume = name === "rolling" ? 0.65 : 0.7;
      player.obeyMuteSwitch = false;
      player.src = `assets/${name}.wav`;
      audio[name] = player;
    } catch (error) { audioError(name, error); }
  }
  function update() {
    if (alive) invalidate();
  }
  function sound(method, name) {
    for (const key of name ? [name] : Object.keys(audio)) {
      try {
        if (audio[key] && typeof audio[key][method] === "function") audio[key][method]();
      } catch (error) {
        if (method === "play") audioError(key, error);
      }
    }
  }
  function toast(title) {
    if (!alive) return;
    try { wxApi.showToast({ title, icon: "none", duration: 2200 }); } catch (_) {}
  }
  function saveGame() {
    try {
      wxApi.setStorageSync(SETTINGS_KEY, {
        count: state.count,
        soundEnabled: state.soundEnabled,
        history: state.history,
      });
    } catch (_) {}
  }
  function cancelRoll() {
    ++epoch;
    clearTimer(rollTimer);
    if (state.rolling && beforeRoll) {
      state.values = beforeRoll.values;
      state.resultReady = beforeRoll.resultReady;
    }
    state.rolling = false;
    beforeRoll = null;
    state.celebrateAt = null;
    sound("stop");
    update();
  }
  async function roll() {
    if (!alive || state.rolling || state.photoBusy) return;
    const token = ++epoch;
    beforeRoll = { values: state.values.slice(), resultReady: state.resultReady };
    state.rolling = true;
    state.resultReady = false;
    state.rollStartedAt = now();
    state.celebrateAt = null;
    sound("stop");
    if (state.soundEnabled) sound("play", "rolling");
    update();
    try {
      const values = await randomRoll(state.count, wxApi);
      if (!alive || token !== epoch) return;
      state.values = values;
      update();
      rollTimer = setTimer(() => {
        if (!alive || token !== epoch) return;
        state.rolling = false;
        state.resultReady = true;
        state.celebrateAt = now();
        beforeRoll = null;
        state.history.unshift({ values: values.slice(), time: now() });
        state.history = state.history.slice(0, 8);
        saveGame();
        sound("stop");
        if (state.soundEnabled) sound("play", "landing");
        update();
      }, Math.max(0, ROLL_DURATION - (now() - state.rollStartedAt)));
    } catch (_) {
      if (!alive || token !== epoch) return;
      cancelRoll();
      toast("这次没能掷出骰子，请再试一次");
    }
  }
  const paths = (photos) => [photos.single, ...photos.faces].filter(Boolean);
  async function choose(kind, face) {
    if (!alive || state.rolling || state.photoBusy) return;
    state.photoBusy = true;
    state.photoStatus = "选一张喜欢的照片吧…";
    update();
    let created = [];
    let committed = false;
    try {
      created = await photoStore.select(kind === "batch" ? 6 : 1);
      if (!alive) return;
      const previous = state.photos;
      const next = { ...previous, faces: previous.faces.slice() };
      if (kind === "single") {
        next.mode = "single";
        next.single = created[0];
      } else {
        next.mode = "six";
        if (kind === "batch") next.faces = created.slice();
        else next.faces[face - 1] = created[0];
      }
      photoStore.save(next);
      state.photos = next;
      committed = true;
      state.photoStatus = "新衣穿好啦，掷一次看看！";
      update();
      const retained = new Set(paths(next));
      await photoStore.remove(paths(previous).filter((path) => !retained.has(path)));
    } catch (error) {
      if (!alive) return;
      if (error && error.cancelled) state.photoStatus = PHOTO_HINT;
      else {
        state.photoStatus = committed
          ? "照片已设置，部分旧照片暂时无法清理。"
          : error && error.message || "照片设置失败，请重新选择。";
        toast(state.photoStatus);
      }
    } finally {
      if (!committed && created.length) {
        try { await photoStore.remove(created); } catch (_) {}
      }
      state.photoBusy = false;
      update();
    }
  }
  async function clearPhotos() {
    if (!alive || state.rolling || state.photoBusy) return;
    state.photoBusy = true;
    update();
    let committed = false;
    try {
      const approved = await new Promise((resolve) => {
        wxApi.showModal({
          title: "恢复原色骰子？",
          content: "将清除游戏保存的照片副本，不会删除手机相册里的原图。",
          confirmText: "清除照片",
          success: (result) => resolve(Boolean(result.confirm)),
          fail: () => resolve(false),
        });
      });
      if (!alive || !approved) return;
      const next = photoStore.defaultSettings();
      photoStore.save(next);
      state.photos = next;
      committed = true;
      state.photoStatus = PHOTO_HINT;
      update();
      // Scan our private directory too, so a retry can clear leftovers from a
      // previous cleanup that failed after the new settings were committed.
      await photoStore.clear();
    } catch (_) {
      if (alive) {
        state.photoStatus = committed
          ? "已恢复原色，部分旧照片暂时无法清理。"
          : "暂时无法清除照片，请稍后再试。";
        toast(state.photoStatus);
      }
    } finally {
      state.photoBusy = false;
      update();
    }
  }
  function handleAction(target) {
    if (!alive || !target) return;
    const { action, value } = target;
    if (action === "sound") {
      state.soundEnabled = !state.soundEnabled;
      sound("stop");
      if (state.soundEnabled) {
        configureAudio();
        sound("play", state.rolling ? "rolling" : "landing");
      }
      saveGame();
    } else if (action === "togglePhotos") {
      state.photoOpen = !state.photoOpen;
    } else if (state.rolling || state.photoBusy) return;
    else if (action === "roll") return roll();
    else if (action === "count") {
      state.count = normalizeDiceCount(value);
      state.values = Array.from({ length: state.count }, (_, i) => ((i + 2) % 6) + 1);
      state.resultReady = false;
      state.celebrateAt = null;
      saveGame();
    } else if (action === "mode") {
      if (!["default", "single", "six"].includes(value)) return;
      try {
        const next = { ...state.photos, mode: value };
        photoStore.save(next);
        state.photos = next;
        state.photoStatus = PHOTO_HINT;
      } catch (_) { toast("暂时无法保存设置，请稍后再试。"); }
    } else if (action === "chooseSingle") return choose("single");
    else if (action === "chooseSix") return choose("batch");
    else if (action === "chooseFace") {
      const face = Number(value);
      if (Number.isInteger(face) && face >= 1 && face <= 6) return choose("face", face);
    } else if (action === "clearPhotos") return clearPhotos();
    else if (action === "clearHistory") {
      state.history = [];
      saveGame();
    }
    update();
  }
  return {
    state,
    handleAction,
    hide: cancelRoll,
    show: update,
    setScroll(value, maximum) {
      state.scrollY = Math.max(0, Math.min(maximum, value));
      update();
    },
    destroy() {
      cancelRoll();
      alive = false;
      sound("destroy");
    },
  };
}

module.exports = { createGame, ROLL_DURATION };
