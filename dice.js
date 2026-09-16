export const MAX_DICE = 6;

/** Convert a number or numeric string to a whole count from 1 through MAX_DICE. */
export function normalizeDiceCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return 1;

  const count = Number(value);
  if (!Number.isFinite(count)) return 1;

  return Math.min(MAX_DICE, Math.max(1, Math.trunc(count)));
}

/**
 * Roll independent, fair six-sided dice. Counts use normalizeDiceCount's rules.
 * Reject bytes 252–255 so each face has exactly 42 possible accepted bytes.
 */
export function rollDice(count, cryptoSource = globalThis.crypto) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== "function") {
    throw new TypeError("A crypto source with getRandomValues is required.");
  }

  const diceCount = normalizeDiceCount(count);
  const results = [];

  while (results.length < diceCount) {
    const bytes = new Uint8Array(diceCount - results.length);
    cryptoSource.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte < 252) results.push((byte % 6) + 1);
    }
  }

  return results;
}
