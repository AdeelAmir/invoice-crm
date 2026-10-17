import { describe, expect, it } from "vitest";
import { computeTotals, taxLinesFor } from "@/lib/tax";
import { formatMoney, fromCents, toCents } from "@/lib/money";

describe("taxLinesFor", () => {
  it("charges GST + QST in Quebec", () => {
    expect(taxLinesFor("CA", "QC")).toEqual([
      { name: "GST", ratePercent: 5 },
      { name: "QST", ratePercent: 9.975 },
    ]);
  });

  it("charges HST in harmonized provinces", () => {
    expect(taxLinesFor("CA", "ON")).toEqual([{ name: "HST", ratePercent: 13 }]);
    expect(taxLinesFor("CA", "NS")).toEqual([{ name: "HST", ratePercent: 14 }]);
    expect(taxLinesFor("CA", "NB")).toEqual([{ name: "HST", ratePercent: 15 }]);
  });

  it("charges GST only elsewhere in Canada", () => {
    expect(taxLinesFor("CA", "AB")).toEqual([{ name: "GST", ratePercent: 5 }]);
    expect(taxLinesFor("CA", "BC")).toEqual([{ name: "GST", ratePercent: 5 }]);
  });

  it("charges no Canadian tax outside Canada", () => {
    expect(taxLinesFor("US", "NY")).toEqual([]);
  });
});

describe("computeTotals", () => {
  it("computes Quebec taxes on the subtotal, rounded to the cent", () => {
    const t = computeTotals([{ quantity: 1, unitPriceCents: 10000 }], taxLinesFor("CA", "QC"));
    expect(t.subtotalCents).toBe(10000);
    expect(t.taxes.map((x) => x.amountCents)).toEqual([500, 998]); // 9.975 -> 9.98
    expect(t.totalCents).toBe(11498);
  });

  it("multiplies quantity by unit price per line", () => {
    const t = computeTotals(
      [
        { quantity: 12, unitPriceCents: 3999 },
        { quantity: 1.5, unitPriceCents: 9500 },
      ],
      [],
    );
    expect(t.lines.map((l) => l.lineTotalCents)).toEqual([47988, 14250]);
    expect(t.totalCents).toBe(62238);
  });
});

describe("money", () => {
  it("round-trips cents without float drift", () => {
    expect(toCents("0.1")).toBe(10);
    expect(toCents("114.98")).toBe(11498);
    expect(fromCents(11498)).toBe("114.98");
    expect(fromCents(5)).toBe("0.05");
    expect(fromCents(-250)).toBe("-2.50");
  });

  it("formats with the currency", () => {
    expect(formatMoney("1234.5", "CAD")).toBe("$1,234.50");
    expect(formatMoney("10", "USD")).toBe("US$10.00");
  });
});
