const MAX_DICE = 6;
const RANDOM_TIMEOUT = 500;

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

function randomBytes(wxApi, length, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("随机点数生成失败，请再掷一次。"));
    };
    const timer = setTimeout(fail, timeout);
    try {
      wxApi.getRandomValues({
        length,
        success(result) {
          if (settled) return;
          const buffer = result && result.randomValues;
          // Native bridges can return an ArrayBuffer from another JS context.
          // Checking its tag works across contexts, unlike instanceof.
          if (
            Object.prototype.toString.call(buffer) !== "[object ArrayBuffer]" ||
            buffer.byteLength !== length
          ) {
            fail();
            return;
          }
          try {
            const bytes = new Uint8Array(buffer);
            settled = true;
            clearTimeout(timer);
            resolve(bytes);
          } catch (_) {
            fail();
          }
        },
        fail,
      });
    } catch (_) {
      fail();
    }
  });
}

function localRoll(count) {
  // A local fallback keeps this family game usable on unsupported clients.
  // It is not intended for prizes, wagering, or security-sensitive decisions.
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

async function rollDice(count, wxApi) {
  const diceCount = normalizeDiceCount(count);
  if (!wxApi || typeof wxApi.getRandomValues !== "function") {
    return localRoll(diceCount);
  }

  try {
    const results = [];
    const deadline = Date.now() + RANDOM_TIMEOUT;
    // Reject bytes 252–255 so every face has exactly 42 accepted byte values.
    // Bound the entire request so fallback finishes within the roll animation.
    for (
      let attempt = 0;
      results.length < diceCount && attempt < 128;
      attempt += 1
    ) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return localRoll(diceCount);
      const bytes = await randomBytes(
        wxApi,
        diceCount - results.length,
        remaining,
      );
      for (const byte of bytes) {
        if (byte < 252) results.push((byte % 6) + 1);
      }
    }
    return results.length === diceCount ? results : localRoll(diceCount);
  } catch (_) {
    return localRoll(diceCount);
  }
}

module.exports = {
  MAX_DICE,
  FACE_VALUES,
  TOP_ORIENTATIONS,
  normalizeDiceCount,
  rollDice,
};
