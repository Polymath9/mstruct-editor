import { parseBpmValue } from "./mstruct-tempo.js";

function bigintGcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

export function exact(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error("Invalid exact value");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = bigintGcd(numerator, denominator);
  return { numerator: (sign * numerator) / divisor, denominator: (denominator < 0n ? -denominator : denominator) / divisor };
}

export function addExact(left, right) {
  return exact(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function exactToNumber(value) {
  return Number(value.numerator) / Number(value.denominator);
}

export function roundExactMilliseconds(value) {
  const rounded = (value.numerator * 2n + value.denominator) / (value.denominator * 2n);
  if (value.numerator < 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(rounded);
}

export function durationMilliseconds(duration, bpmValue) {
  const bpm = parseBpmValue(bpmValue);
  if (!bpm) return null;
  const [whole, fraction = ""] = bpm.tempo.split(".");
  const tempo = exact(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length));
  return exact(
    BigInt(duration.numerator) * BigInt(bpm.beat.denominator) * 60000n * tempo.denominator,
    BigInt(duration.denominator) * BigInt(bpm.beat.numerator) * tempo.numerator,
  );
}
