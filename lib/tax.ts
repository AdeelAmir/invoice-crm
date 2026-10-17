// Canadian sales tax by the client's billing province (rates as of 2026).
//
// - Quebec: GST 5% + QST 9.975%.
// - HST provinces: one harmonized rate (Nova Scotia 14% since 2025-04-01).
// - Everywhere else in Canada: GST 5%. BC, MB and SK also have a provincial
//   sales tax, but whether it applies depends on the service sold, so the
//   demo charges GST only there.
// - Outside Canada: no Canadian tax.

export type TaxLine = { name: string; ratePercent: number };

export const CANADIAN_PROVINCES: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

const HST: Record<string, number> = { ON: 13, NB: 15, NL: 15, PE: 15, NS: 14 };

export function taxLinesFor(country: string, province: string): TaxLine[] {
  if (country !== "CA") return [];
  if (province === "QC") {
    return [
      { name: "GST", ratePercent: 5 },
      { name: "QST", ratePercent: 9.975 },
    ];
  }
  if (province in HST) return [{ name: "HST", ratePercent: HST[province] }];
  return [{ name: "GST", ratePercent: 5 }];
}

export type LineInput = { quantity: number; unitPriceCents: number };

export type InvoiceTotals = {
  lines: { lineTotalCents: number }[];
  subtotalCents: number;
  taxes: { name: string; ratePercent: number; amountCents: number }[];
  taxTotalCents: number;
  totalCents: number;
};

// Each tax is computed on the subtotal (QST is not charged on GST) and
// rounded half-up to the cent.
export function computeTotals(lines: LineInput[], taxLines: TaxLine[]): InvoiceTotals {
  const computed = lines.map((l) => ({
    lineTotalCents: Math.round(l.quantity * l.unitPriceCents),
  }));
  const subtotalCents = computed.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const taxes = taxLines.map((t) => ({
    ...t,
    // the rate in thousandths of a percent keeps 9.975 exact
    amountCents: Math.round((subtotalCents * Math.round(t.ratePercent * 1000)) / 100000),
  }));
  const taxTotalCents = taxes.reduce((sum, t) => sum + t.amountCents, 0);
  return {
    lines: computed,
    subtotalCents,
    taxes,
    taxTotalCents,
    totalCents: subtotalCents + taxTotalCents,
  };
}
