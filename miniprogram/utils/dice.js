const MAX_DICE = 6;

// Opposite faces add up to seven, matching the web version's physical cube.
const FACE_VALUES = Object.freeze({
  front: 1,
  back: 6,
  right: 3,
  left: 4,
  top: 2,
  bottom: 5,
});

// rotateY runs before rotateX; the selected face ends up pointing upward.
const TOP_ORIENTATIONS = Object.freeze({
  1: Object.freeze([90, 0]),
  2: Object.freeze([0, 0]),
  3: Object.freeze([90, -90]),
  4: Object.freeze([90, 90]),
  5: Object.freeze([180, 0]),
  6: Object.freeze([-90, 0]),
});

function normalizeDiceCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return 1;
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.min(MAX_DICE, Math.max(1, Math.trunc(count)));
}

function randomBytes(manager, length) {
  return new Promise((resolve, reject) => {
    manager.getRandomValues({
      length,
      success(result) {
        const buffer = result && result.randomValues;
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== length) {
          reject(new Error("随机点数生成失败，请再掷一次。"));
          return;
        }
        resolve(new Uint8Array(buffer));
      },
      fail() {
        reject(new Error("随机点数生成失败，请再掷一次。"));
      },
    });
  });
}

async function rollDice(count, wxApi) {
  const diceCount = normalizeDiceCount(count);
  if (!wxApi || typeof wxApi.getUserCryptoManager !== "function") {
    // Compatibility fallback for older clients: suitable for a family game,
    // never for prizes, wagering, or any security-sensitive random decision.
    return Array.from(
      { length: diceCount },
      () => Math.floor(Math.random() * 6) + 1,
    );
  }

  const manager = wxApi.getUserCryptoManager();
  if (!manager || typeof manager.getRandomValues !== "function") {
    throw new Error("随机点数生成失败，请再掷一次。");
  }

  const results = [];
  // Reject bytes 252–255 so every face has exactly 42 accepted byte values.
  // A broken provider must not leave the page rolling forever.
  for (
    let attempt = 0;
    results.length < diceCount && attempt < 128;
    attempt += 1
  ) {
    const bytes = await randomBytes(manager, diceCount - results.length);
    for (const byte of bytes) {
      if (byte < 252) results.push((byte % 6) + 1);
    }
  }
  if (results.length !== diceCount) {
    throw new Error("随机点数生成失败，请再掷一次。");
  }
  return results;
}

module.exports = {
  MAX_DICE,
  FACE_VALUES,
  TOP_ORIENTATIONS,
  normalizeDiceCount,
  rollDice,
};
