// All money arithmetic happens in integer cents; Decimal columns are only
// read and written at the edges.

type DecimalLike = { toString(): string } | number | string;

export function toCents(value: DecimalLike): number {
  const n = Number(typeof value === "object" ? value.toString() : value);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${String(value)}`);
  return Math.round(n * 100);
}

export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("cents must be an integer");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(value: DecimalLike, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    toCents(value) / 100,
  );
}
