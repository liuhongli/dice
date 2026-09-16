import {
  preparePhoto,
  loadPhotoSettings,
  savePhotoSettings,
  clearPhotoSettings,
} from "./photos.js";

const emptySettings = () => ({
  mode: "default",
  single: null,
  faces: Array(6).fill(null),
});

const copySettings = (settings) => ({
  mode: settings.mode,
  single: settings.single,
  faces: [...settings.faces],
});

const SAVE_WARNING = "照片已应用，但浏览器未能保存，刷新后需要重新选择。";

export function createPhotoCustomizer({ onChange, onBusy }) {
  const $ = (selector) => document.querySelector(selector);
  const controls = $("#photo-controls");
  const modeInputs = controls.querySelectorAll('input[name="photo-mode"]');
  const singleInput = $("#single-photo-input");
  const sixInput = $("#six-photo-input");
  const faceInput = $("#face-photo-input");
  const faceSlots = [...controls.querySelectorAll(".face-photo-slot")];
  const status = $("#photo-status");
  let settings = emptySettings();
  let rolling = false;
  let busy = false;
  let restoring = true;
  let pendingChange = false;
  let selectedFace = 0;

  function updateDisabled() {
    controls.disabled = rolling || busy || restoring;
    controls.setAttribute("aria-busy", String(busy || restoring));
  }

  function setBusy(value) {
    busy = value;
    updateDisabled();
    onBusy(value);
  }

  function updatePreview(preview, empty, source) {
    preview.hidden = !source;
    empty.hidden = Boolean(source);
    if (source) preview.src = source;
    else preview.removeAttribute("src");
  }

  function render() {
    for (const input of modeInputs) {
      input.checked = input.value === settings.mode;
    }
    $("#photo-single-panel").hidden = settings.mode !== "single";
    $("#photo-six-panel").hidden = settings.mode !== "six";
    updatePreview(
      $("#single-photo-preview"),
      $("#single-photo-empty"),
      settings.single,
    );
    for (const slot of faceSlots) {
      const face = Number(slot.dataset.face);
      const source = settings.faces[face - 1];
      updatePreview(
        slot.querySelector(".face-photo-preview"),
        slot.querySelector(".face-photo-empty"),
        source,
      );
      slot.classList.toggle("has-photo", Boolean(source));
      slot.setAttribute(
        "aria-label",
        `${face} 点面，${source ? "已设置照片，点击更换" : "点击选择照片"}`,
      );
    }
    const configured = settings.faces.filter(Boolean).length;
    $("#six-photo-progress").textContent =
      configured === 6
        ? "6 个面都已设置好，可以随时点选更换。"
        : `已设置 ${configured} / 6 个面；未设置的面保留原色。`;
    $("#photo-summary").textContent =
      settings.mode === "default"
        ? "原色骰子"
        : settings.mode === "single"
          ? settings.single
            ? "一张照片 · 六个面"
            : "等待选择照片"
          : `每面一张 · ${configured} / 6`;
  }

  function notifyChange() {
    if (rolling) {
      pendingChange = true;
      return;
    }
    pendingChange = false;
    onChange(copySettings(settings));
  }

  function apply(next) {
    settings = copySettings(next);
    render();
    notifyChange();
  }

  async function persist(successMessage) {
    try {
      const result = await savePhotoSettings(copySettings(settings));
      if (result === false) throw new Error("Storage unavailable");
      status.textContent = successMessage;
    } catch {
      status.textContent = SAVE_WARNING;
    }
  }

  function available() {
    return !rolling && !busy && !restoring;
  }

  async function processSelection(input, requiredCount, applyPhotos) {
    const files = [...(input.files || [])];
    let ownsBusyState = false;
    try {
      if (!files.length || !available()) return;
      if (files.length !== requiredCount) {
        status.textContent =
          requiredCount === 6
            ? "请一次选择 6 张照片，分别对应 1–6 点面。也可以逐个点选下面的面。"
            : "请选择 1 张照片。";
        return;
      }
      setBusy(true);
      ownsBusyState = true;
      const prepared = [];
      for (let index = 0; index < files.length; index += 1) {
        status.textContent =
          files.length === 1
            ? "正在准备照片…"
            : `正在准备第 ${index + 1} / 6 张照片…`;
        prepared.push(await preparePhoto(files[index]));
      }
      // Commit only after all photos are ready, so failed batches change nothing.
      const { next, message } = applyPhotos(prepared);
      apply(next);
      await persist(message);
    } catch (error) {
      status.textContent =
        error instanceof Error && error.message
          ? error.message
          : "这张照片没能打开，请换一张再试。";
    } finally {
      input.value = "";
      if (ownsBusyState) setBusy(false);
    }
  }

  for (const input of modeInputs) {
    input.addEventListener("change", async () => {
      if (!available() || !input.checked) return;
      setBusy(true);
      try {
        apply({ ...settings, mode: input.value });
        const message =
          settings.mode === "default"
            ? "已切换为原色骰子，选好的照片仍会保留。"
            : settings.mode === "single"
              ? settings.single
                ? "已将同一张照片应用到骰子的 6 个面。"
                : "从相册选择一张照片，装饰骰子的 6 个面吧。"
              : "为 1–6 点面分别选择照片，也可以一次选择 6 张。";
        await persist(message);
      } finally {
        setBusy(false);
      }
    });
  }

  $("#choose-single-photo").addEventListener("click", () => {
    if (available()) singleInput.click();
  });
  $("#choose-six-photos").addEventListener("click", () => {
    if (available()) sixInput.click();
  });
  for (const slot of faceSlots) {
    slot.addEventListener("click", () => {
      if (!available()) return;
      selectedFace = Number(slot.dataset.face) - 1;
      faceInput.click();
    });
  }

  singleInput.addEventListener("change", () =>
    processSelection(singleInput, 1, ([photo]) => ({
      next: { ...settings, mode: "single", single: photo },
      message: "照片已装饰好骰子的 6 个面，快掷一次吧！",
    })),
  );
  sixInput.addEventListener("change", () =>
    processSelection(sixInput, 6, (photos) => ({
      next: { ...settings, mode: "six", faces: photos },
      message: "6 张照片已按选择顺序对应 1–6 点面，可以点选任意面更换。",
    })),
  );
  faceInput.addEventListener("change", () => {
    const face = selectedFace;
    return processSelection(faceInput, 1, ([photo]) => {
      const faces = [...settings.faces];
      faces[face] = photo;
      const configured = faces.filter(Boolean).length;
      return {
        next: { ...settings, mode: "six", faces },
        message:
          configured === 6
            ? `${face + 1} 点面的照片已更新，6 个面都准备好啦！`
            : `${face + 1} 点面的照片已设置，共 ${configured} / 6 个面；其他面保留原色。`,
      };
    });
  });

  $("#reset-photos").addEventListener("click", async () => {
    if (!available()) return;
    setBusy(true);
    try {
      apply(emptySettings());
      const result = await clearPhotoSettings();
      if (result === false) throw new Error("Storage unavailable");
      status.textContent = "已恢复原色骰子，并清除保存的照片。";
    } catch {
      status.textContent =
        "已恢复原色，但浏览器未能清除保存的照片，刷新后可能需要重新设置。";
    } finally {
      setBusy(false);
    }
  });

  render();
  updateDisabled();
  // Restore asynchronously so the caller can finish initializing the game first.
  Promise.resolve()
    .then(() => loadPhotoSettings())
    .then((saved) => {
      apply(saved || emptySettings());
    })
    .catch(() => {
      status.textContent = "暂时无法读取保存的照片，可以重新从相册选择。";
    })
    .finally(() => {
      restoring = false;
      updateDisabled();
    });

  return {
    setRolling(value) {
      rolling = Boolean(value);
      updateDisabled();
      if (!rolling && pendingChange) notifyChange();
    },
  };
}
