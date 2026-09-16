const {
  normalizeDiceCount,
  rollDice,
  FACE_VALUES,
  TOP_ORIENTATIONS,
} = require("../../utils/dice.js");
const { createPhotoStore } = require("../../utils/photos.js");

const SETTINGS_KEY = "dice-party-mini-v1";
const ROLL_DURATION = 2000;
const PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
const COLORS = [
  "#df9680",
  "#e9c35d",
  "#89b593",
  "#8baec9",
  "#b69dcc",
  "#d59aae",
];

function initialValues(count) {
  return Array.from({ length: count }, (_, index) => ((index + 2) % 6) + 1);
}

function photoPaths(settings) {
  return [settings.single, ...settings.faces].filter(Boolean);
}

function buildDice(values, photos) {
  return values.map((value, index) => ({
    id: index,
    value,
    rx: TOP_ORIENTATIONS[value][0],
    ry: TOP_ORIENTATIONS[value][1],
    faces: Object.keys(FACE_VALUES).map((side) => {
      const dots = FACE_VALUES[side];
      return {
        side,
        value: dots,
        photo:
          photos.mode === "single"
            ? photos.single || ""
            : photos.mode === "six"
              ? photos.faces[dots - 1] || ""
              : "",
        pips: PIPS[dots].map((position) => ({
          id: position,
          left: 23 + ((position - 1) % 3) * 27,
          top: 23 + Math.floor((position - 1) / 3) * 27,
        })),
      };
    }),
  }));
}

function historyRows(history) {
  return history.map((entry, index) => {
    const date = new Date(entry.time);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return {
      id: entry.time,
      values: entry.values,
      total: entry.values.reduce((a, b) => a + b, 0),
      timeText: index === 0 ? "最近一次" : `${hours}:${minutes}`,
    };
  });
}

Page({
  data: {
    count: 1,
    countOptions: [1, 2, 3, 4, 5, 6],
    dice: [],
    rolling: false,
    soundEnabled: true,
    totalText: "?",
    resultTitle: "准备就绪",
    resultDetail: "下一次，会是几点呢？",
    stageCaption: "小小骰子，大大可能",
    stageBadge: "每一面，都有惊喜",
    history: [],
    confetti: [],
    photoOpen: false,
    photoMode: "default",
    singlePhoto: "",
    facePhotos: [1, 2, 3, 4, 5, 6].map((value) => ({ value, path: "" })),
    photoStatus: "照片只保存在这台设备上，不会上传。",
    photoBusy: false,
    privacyVisible: false,
    privacyContractName: "《用户隐私保护指引》",
  },

  onLoad() {
    this._alive = true;
    this._rollEpoch = 0;
    this._history = [];
    this._store = createPhotoStore(wx);
    this._photos = this._store.defaultSettings();
    let count = 1;
    let soundEnabled = true;
    try {
      const saved = wx.getStorageSync(SETTINGS_KEY);
      if (saved && typeof saved === "object") {
        count = normalizeDiceCount(saved.count);
        soundEnabled = saved.soundEnabled !== false;
        this._history = Array.isArray(saved.history)
          ? saved.history
              .filter(
                (entry) =>
                  entry &&
                  Number.isFinite(entry.time) &&
                  entry.time > 0 &&
                  Array.isArray(entry.values) &&
                  entry.values.length >= 1 &&
                  entry.values.length <= 6 &&
                  entry.values.every(
                    (value) =>
                      Number.isInteger(value) && value >= 1 && value <= 6,
                  ),
              )
              .slice(0, 8)
          : [];
      }
    } catch {
      /* Storage is optional for normal dice rolls. */
    }
    try {
      this._photos = this._store.load();
    } catch {
      this.setData({ photoStatus: "暂时无法读取照片，可以重新从相册选择。" });
    }
    this._values = initialValues(count);
    this.setData({ count, soundEnabled, history: historyRows(this._history) });
    this._renderPhotos();
    this._createAudio();
    this._registerPrivacy();
    if (wx.showShareMenu)
      wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onHide() {
    this._stopRoll();
    this._stopAudio();
    clearTimeout(this._confettiTimer);
    this.setData({ confetti: [] });
  },

  onUnload() {
    this._stopRoll();
    this._alive = false;
    clearTimeout(this._confettiTimer);
    this._stopAudio();
    for (const audio of [this._rollingAudio, this._landingAudio]) {
      if (audio) audio.destroy();
    }
    if (this._privacyResolve) this._privacyResolve({ event: "disagree" });
    this._privacyResolve = null;
    if (wx.offNeedPrivacyAuthorization && this._privacyListener) {
      wx.offNeedPrivacyAuthorization(this._privacyListener);
    }
  },

  _saveGame() {
    try {
      wx.setStorageSync(SETTINGS_KEY, {
        count: this.data.count,
        soundEnabled: this.data.soundEnabled,
        history: this._history,
      });
    } catch {
      /* Dice remain playable without persistence. */
    }
  },

  _createAudio() {
    if (!wx.createInnerAudioContext) return;
    try {
      this._rollingAudio = wx.createInnerAudioContext();
      this._rollingAudio.src = "/assets/rolling.wav";
      this._rollingAudio.volume = 0.35;
      this._rollingAudio.obeyMuteSwitch = true;
      this._rollingAudio.onError(() => {});
      this._landingAudio = wx.createInnerAudioContext();
      this._landingAudio.src = "/assets/landing.wav";
      this._landingAudio.volume = 0.4;
      this._landingAudio.obeyMuteSwitch = true;
      this._landingAudio.onError(() => {});
    } catch {
      /* Sound is optional on unsupported devices. */
    }
  },

  _stopAudio() {
    if (this._rollingAudio) this._rollingAudio.stop();
    if (this._landingAudio) this._landingAudio.stop();
  },

  onToggleSound() {
    this.setData({ soundEnabled: !this.data.soundEnabled });
    if (!this.data.soundEnabled) this._stopAudio();
    this._saveGame();
  },

  onCountTap(event) {
    if (this.data.rolling || this.data.photoBusy) return;
    const count = normalizeDiceCount(event.currentTarget.dataset.value);
    this._values = initialValues(count);
    this.setData({
      count,
      dice: buildDice(this._values, this._photos),
      totalText: "?",
      resultTitle: "准备就绪",
      resultDetail: "下一次，会是几点呢？",
      stageCaption: "小小骰子，大大可能",
      stageBadge: "每一面，都有惊喜",
    });
    this._saveGame();
  },

  async onRoll() {
    if (this.data.rolling || this.data.photoBusy) return;
    const epoch = ++this._rollEpoch;
    const started = Date.now();
    clearTimeout(this._confettiTimer);
    this.setData({
      rolling: true,
      confetti: [],
      totalText: "··",
      resultTitle: "期待一下",
      resultDetail: "让好运飞一小会儿…",
      stageCaption: "咕噜咕噜，好运马上到…",
      stageBadge: "好运正在路上",
    });
    this._stopAudio();
    if (this.data.soundEnabled && this._rollingAudio) this._rollingAudio.play();
    try {
      const values = await rollDice(this.data.count, wx);
      if (!this._alive || epoch !== this._rollEpoch) return;
      this._rollTimer = setTimeout(
        () => {
          if (this._alive && epoch === this._rollEpoch)
            this._finishRoll(values);
        },
        Math.max(0, ROLL_DURATION - (Date.now() - started)),
      );
    } catch {
      if (!this._alive || epoch !== this._rollEpoch) return;
      this._stopRoll();
      this._stopAudio();
      wx.showToast({ title: "这次没能掷出骰子，请再试一次", icon: "none" });
    }
  },

  _stopRoll() {
    ++this._rollEpoch;
    clearTimeout(this._rollTimer);
    if (this.data.rolling)
      this.setData({
        rolling: false,
        totalText: "?",
        resultTitle: "准备就绪",
        resultDetail: "下一次，会是几点呢？",
        stageCaption: "小小骰子，大大可能",
        stageBadge: "每一面，都有惊喜",
      });
  },

  _finishRoll(values) {
    this._values = values;
    const total = values.reduce((a, b) => a + b, 0);
    const hasSix = values.includes(6);
    this._history.unshift({ values, time: Date.now() });
    this._history = this._history.slice(0, 8);
    this.setData({
      rolling: false,
      dice: buildDice(values, this._photos),
      totalText: String(total),
      resultTitle:
        values.length === 1
          ? "这次的顶面点数"
          : `${values.length} 颗骰子 · 顶面合计`,
      resultDetail:
        values.length === 1
          ? "轮到你迈出快乐的一步啦"
          : `${values.join(" + ")} = ${total}`,
      stageCaption: hasSix ? "六六大顺！好运抱个满怀" : "叮！你的好运，已送达",
      stageBadge: hasSix ? "哇！有 6 点耶" : "好运已送达",
      history: historyRows(this._history),
      confetti: Array.from({ length: hasSix ? 32 : 22 }, (_, id) => ({
        id,
        style: `left:${12 + Math.random() * 76}%;background:${COLORS[id % COLORS.length]};animation-delay:${Math.random() * 0.2}s;--drift:${(Math.random() - 0.5) * 160}rpx;`,
      })),
    });
    this._saveGame();
    this._stopAudio();
    if (this.data.soundEnabled && this._landingAudio) this._landingAudio.play();
    this._confettiTimer = setTimeout(() => {
      if (this._alive) this.setData({ confetti: [] });
    }, 2300);
  },

  onClearHistory() {
    this._history = [];
    this.setData({ history: [] });
    this._saveGame();
  },

  _renderPhotos() {
    this.setData({
      photoMode: this._photos.mode,
      singlePhoto: this._photos.single || "",
      facePhotos: this._photos.faces.map((path, index) => ({
        value: index + 1,
        path: path || "",
      })),
      dice: buildDice(this._values, this._photos),
    });
  },

  onTogglePhotos() {
    this.setData({ photoOpen: !this.data.photoOpen });
  },

  onModeTap(event) {
    if (this.data.rolling || this.data.photoBusy) return;
    const mode = event.currentTarget.dataset.mode;
    if (!["default", "single", "six"].includes(mode)) return;
    this._photos = { ...this._photos, mode };
    let status =
      mode === "default"
        ? "已恢复原色，选好的照片仍会保留。"
        : mode === "single"
          ? "选择一张照片，装饰所有骰子的六个面。"
          : "点击 1–6 点面分别选图，或一次选择六张。";
    try {
      this._store.save(this._photos);
    } catch {
      status = "本次设置可以使用，但未能保存，重新打开后需再设置。";
    }
    this._renderPhotos();
    this.setData({ photoStatus: status });
  },

  onChooseSingle() {
    return this._choosePhotos("single");
  },
  onChooseSix() {
    return this._choosePhotos("six");
  },
  onChooseFace(event) {
    const face = Number(event.currentTarget.dataset.value);
    if (Number.isInteger(face) && face >= 1 && face <= 6)
      return this._choosePhotos("face", face - 1);
  },

  async _choosePhotos(mode, faceIndex) {
    if (this.data.rolling || this.data.photoBusy) return;
    const count = mode === "six" ? 6 : 1;
    this.setData({ photoBusy: true });
    let created = [];
    let committed = false;
    try {
      await this._requirePrivacy();
      if (!this._alive) return;
      const result = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count,
          mediaType: ["image"],
          sourceType: ["album"],
          sizeType: ["compressed"],
          success: resolve,
          fail: reject,
        }),
      );
      if (!this._alive) return;
      if (!Array.isArray(result.tempFiles) || result.tempFiles.length !== count)
        throw new Error(
          count === 6
            ? "请一次选择六张照片，也可以逐面设置。"
            : "请选择一张照片。",
        );
      this.setData({ photoStatus: "正在为骰子准备照片…" });
      created = await this._store.prepare(result.tempFiles);
      if (!this._alive) return;
      const oldPaths = photoPaths(this._photos);
      const next = {
        mode: mode === "single" ? "single" : "six",
        single: this._photos.single,
        faces: [...this._photos.faces],
      };
      if (mode === "single") next.single = created[0];
      else if (mode === "six") next.faces = created;
      else next.faces[faceIndex] = created[0];
      // Persist first: a storage failure must leave the previous photos intact.
      this._store.save(next);
      committed = true;
      this._photos = next;
      this._renderPhotos();
      this.setData({
        photoStatus:
          mode === "single"
            ? "照片已铺满六面，快掷一次吧！"
            : "照片已设置好，点选任意一面都能更换。",
      });
      const keep = new Set(photoPaths(next));
      await this._store.remove(oldPaths.filter((path) => !keep.has(path)));
    } catch (error) {
      if (this._alive) {
        const reason = (error && (error.errMsg || error.message)) || "";
        const message = /cancel|privacy|disagree|auth deny/i.test(reason)
          ? "未选择照片，原来的设置已保留。"
          : error instanceof Error
            ? error.message
            : "照片没能设置成功，请换一张再试。";
        this.setData({
          photoStatus: committed
            ? "照片已设置，旧照片暂未清理，稍后可再试。"
            : message,
        });
      }
    } finally {
      if (!committed && created.length)
        await this._store.remove(created).catch(() => {});
      if (this._alive) this.setData({ photoBusy: false });
    }
  },

  async onResetPhotos() {
    if (this.data.rolling || this.data.photoBusy) return;
    this.setData({ photoBusy: true });
    try {
      // Do not delete files unless metadata can first be safely reset.
      const next = this._store.defaultSettings();
      this._store.save(next);
      this._photos = next;
      this._renderPhotos();
      await this._store.clear();
      if (this._alive)
        this.setData({
          photoStatus: "已恢复原色，并清除这台设备上保存的照片副本。",
        });
    } catch {
      if (this._alive)
        this.setData({ photoStatus: "照片未能完全清除，请稍后再试。" });
    } finally {
      if (this._alive) this.setData({ photoBusy: false });
    }
  },

  _registerPrivacy() {
    if (!wx.onNeedPrivacyAuthorization) return;
    this._privacyListener = (resolve) => {
      if (!this._alive) {
        resolve({ event: "disagree" });
        return;
      }
      this._privacyResolve = resolve;
      this.setData({ privacyVisible: true });
      if (wx.getPrivacySetting)
        wx.getPrivacySetting({
          success: (result) => {
            if (this._alive && result.privacyContractName)
              this.setData({ privacyContractName: result.privacyContractName });
          },
        });
    };
    wx.onNeedPrivacyAuthorization(this._privacyListener);
  },

  _requirePrivacy() {
    if (!wx.requirePrivacyAuthorize) return Promise.resolve();
    return new Promise((resolve, reject) =>
      wx.requirePrivacyAuthorize({ success: resolve, fail: reject }),
    );
  },

  onViewPrivacyContract() {
    if (wx.openPrivacyContract)
      wx.openPrivacyContract({
        fail: () =>
          wx.showToast({
            title: "暂时无法打开隐私指引，请稍后再试",
            icon: "none",
          }),
      });
  },

  onPrivacyAgree() {
    // Called only by WeChat's agreePrivacyAuthorization button event.
    if (this._privacyResolve)
      this._privacyResolve({ event: "agree", buttonId: "agree-privacy" });
    this._privacyResolve = null;
    this.setData({ privacyVisible: false });
  },

  onPrivacyDecline() {
    if (this._privacyResolve) this._privacyResolve({ event: "disagree" });
    this._privacyResolve = null;
    this.setData({ privacyVisible: false });
  },

  onShareAppMessage() {
    return {
      title: "骰子派对 · 和大小朋友一起掷出快乐",
      path: "/pages/index/index",
    };
  },
  onShareTimeline() {
    return { title: "骰子派对 · 大小朋友都能玩的幸运骰子" };
  },
});
