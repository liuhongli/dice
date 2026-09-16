import { MAX_DICE, normalizeDiceCount, rollDice } from "./dice.js";
import { createEffects } from "./effects.js";

const $ = (selector) => document.querySelector(selector);
const stage = $("#stage");
const field = $("#dice-field");
const rollButton = $("#roll-button");
const options = $("#dice-options");
const soundButton = $("#sound-toggle");
const effects = createEffects($("#confetti-canvas"));
const STORAGE_KEY = "dice-party-v1";
const ROLL_DURATION = 2000;
const pipPositions = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
const faceValues = { front: 1, back: 6, right: 3, left: 4, top: 2, bottom: 5 };
const orientations = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180],
};
const palettes = [
  ["#fbfff6", "#d5e9d4", "#b3d4bd", "#378368"],
  ["#fff8f2", "#f4d9cb", "#e5baaa", "#cc7d65"],
  ["#f7fcff", "#d4e5f0", "#b4ccd9", "#678ca6"],
  ["#fffdef", "#f0e6b7", "#dacc96", "#b69845"],
  ["#fcf8ff", "#e7dcef", "#cdbad9", "#9b7ba9"],
  ["#fff7f7", "#f0d6dd", "#dbb6c3", "#b7748f"],
];
let count = 1;
let muted = false;
let history = [];
let rolling = false;
let rollTimer;

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return;
    count = normalizeDiceCount(saved.count);
    muted = saved.muted === true;
    if (Array.isArray(saved.history)) {
      history = saved.history
        .filter(
          (entry) =>
            entry &&
            Array.isArray(entry.values) &&
            entry.values.length >= 1 &&
            entry.values.length <= MAX_DICE &&
            entry.values.every(
              (value) => Number.isInteger(value) && value >= 1 && value <= 6,
            ) &&
            Number.isFinite(entry.time) &&
            entry.time > 0,
        )
        .slice(0, 8);
    }
  } catch {
    /* The game also works when browser storage is unavailable. */
  }
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ count, muted, history }),
    );
  } catch {
    /* Optional persistence. */
  }
}

function pips(value, className) {
  return pipPositions[value]
    .map(
      (position) =>
        `<span class="${className}" style="grid-area:${Math.ceil(position / 3)}/${((position - 1) % 3) + 1}"></span>`,
    )
    .join("");
}

function renderDice(values) {
  field.dataset.count = String(values.length);
  field.innerHTML = values
    .map((value, index) => {
      const [face, shade, edge, pip] = palettes[index];
      const [rx, ry] = orientations[value];
      return `<div class="die" role="img" aria-label="第 ${index + 1} 颗骰子：${value} 点" style="--index:${index};--face:${face};--shade:${shade};--edge:${edge};--pip-color:${pip};--rx:${rx}deg;--ry:${ry}deg"><div class="dice-tilt"><div class="dice-cube">${Object.entries(
        faceValues,
      )
        .map(
          ([side, dots]) =>
            `<div class="dice-face ${side}">${pips(dots, "pip")}</div>`,
        )
        .join("")}</div></div></div>`;
    })
    .join("");
  field.setAttribute(
    "aria-label",
    `${values.length} 颗骰子，点数为 ${values.join("、")}`,
  );
}

function setCount(value) {
  count = normalizeDiceCount(value);
  $(`input[name="dice-count"][value="${count}"]`).checked = true;
  $("#quantity-label").textContent = `${count} 颗骰子`;
  renderDice(
    Array.from({ length: count }, (_, index) => ((index + 2) % 6) + 1),
  );
  stage.classList.remove("just-landed");
  $("#result-box").classList.remove("has-result");
  $("#result-label").textContent = "准备就绪";
  $("#result-detail").textContent = "下一次，会是几点呢？";
  $("#result-total").textContent = "?";
  $("#stage-caption").innerHTML =
    '<span class="caption-spark" aria-hidden="true">✦</span> 小小骰子，大大可能 <span class="caption-spark" aria-hidden="true">✦</span>';
  $("#stage-badge").textContent = "每一面，都有惊喜";
  $("#roll-button-text").textContent = "掷出好运";
  save();
}

function renderSound() {
  soundButton.setAttribute("aria-pressed", String(!muted));
  soundButton.setAttribute("aria-label", muted ? "开启音效" : "关闭音效");
  soundButton
    .querySelector("use")
    .setAttribute("href", muted ? "#icon-muted" : "#icon-volume");
  soundButton.querySelector("span").textContent = muted ? "音效关" : "音效开";
  effects.setMuted(muted);
}

function renderHistory() {
  $("#clear-history").hidden = history.length === 0;
  if (!history.length) {
    $("#history-list").innerHTML =
      '<div class="history-empty"><span class="empty-dice" aria-hidden="true">⚂</span><p>快乐还没开场，掷出你的第一份好运吧！</p><span class="empty-trail" aria-hidden="true">· · ·</span></div>';
    return;
  }
  $("#history-list").innerHTML = history
    .map((entry, index) => {
      const sum = entry.values.reduce((total, value) => total + value, 0);
      const time = new Date(entry.time).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return `<div class="history-item${index === 0 ? " latest" : ""}" role="group" aria-label="${index === 0 ? "最近一次" : time}，点数 ${entry.values.join("、")}，合计 ${sum} 点"><div class="history-item-top"><span>${index === 0 ? "最近一次" : time}</span><span class="history-sum">${sum} 点</span></div><div class="history-values" aria-hidden="true">${entry.values.map((value) => `<span class="mini-die">${pips(value, "mini-pip")}</span>`).join("")}</div></div>`;
    })
    .join("");
  $("#history-list").scrollLeft = 0;
}

function setBusy(busy) {
  rolling = busy;
  rollButton.disabled = busy;
  options.disabled = busy;
  stage.setAttribute("aria-busy", String(busy));
  stage.classList.toggle("is-rolling", busy);
}

function finishRoll(values) {
  setBusy(false);
  renderDice(values);
  stage.classList.add("just-landed");
  const total = values.reduce((sum, value) => sum + value, 0);
  const sixes = values.filter((value) => value === 6).length;
  $("#result-box").classList.add("has-result");
  $("#result-label").textContent =
    count === 1 ? "这次的好运" : `${count} 颗骰子 · 总点数`;
  $("#result-detail").textContent =
    count === 1 ? "轮到你迈出快乐的一步啦" : `${values.join(" + ")} = ${total}`;
  $("#result-total").textContent = String(total);
  $("#stage-badge").textContent = sixes ? "哇！有 6 点耶 ✨" : "好运已送达";
  $("#stage-caption").textContent = sixes
    ? "六六大顺！好运抱个满怀 ✨"
    : ["叮！你的好运，已送达", "又是快乐的一小步", "让快乐接着传下去吧"][
        total % 3
      ];
  $("#roll-button-text").textContent = "再掷一次";
  $("#live-status").textContent =
    `投掷完成，${values.map((value, index) => `第 ${index + 1} 颗 ${value} 点`).join("，")}，合计 ${total} 点。`;
  history.unshift({ values, time: Date.now() });
  history = history.slice(0, 8);
  renderHistory();
  save();
  effects.land(values);
}

function roll() {
  if (rolling) return;
  let values;
  try {
    values = rollDice(count);
  } catch {
    $("#live-status").textContent = "这次没能掷出骰子，请刷新页面再试一次。";
    $("#stage-caption").textContent = "骰子打了个小盹，请刷新后再试";
    return;
  }
  effects.unlock();
  effects.stop();
  stage.classList.remove("just-landed");
  setBusy(true);
  $("#roll-button-text").textContent = "好运转动中";
  $("#result-label").textContent = "期待一下";
  $("#result-detail").textContent = "让好运飞一小会儿…";
  $("#result-total").textContent = "· ·";
  $("#result-box").classList.remove("has-result");
  $("#stage-caption").textContent = "咕噜咕噜，好运马上到…";
  $("#stage-badge").textContent = "好运正在路上";
  $("#live-status").textContent = `正在投掷 ${count} 颗骰子，请稍等。`;
  effects.rolling();
  rollTimer = window.setTimeout(() => finishRoll(values), ROLL_DURATION);
}

restore();
setCount(count);
renderSound();
renderHistory();
rollButton.addEventListener("click", roll);
options.addEventListener("change", (event) => {
  if (!rolling) setCount(event.target.value);
});
soundButton.addEventListener("click", () => {
  muted = !muted;
  renderSound();
  if (!muted) effects.unlock();
  save();
});
$("#clear-history").addEventListener("click", () => {
  history = [];
  renderHistory();
  save();
  $("#live-status").textContent = "投掷记录已清空。";
});
document.addEventListener("keydown", (event) => {
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  if (
    event.target.closest(
      'button, input, select, textarea, a, [contenteditable="true"]',
    )
  )
    return;
  event.preventDefault();
  roll();
});
window.addEventListener("pagehide", () => {
  window.clearTimeout(rollTimer);
  effects.stop();
  if (rolling) {
    setBusy(false);
    setCount(count);
  }
});
