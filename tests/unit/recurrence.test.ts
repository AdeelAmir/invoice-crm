import { describe, expect, it } from "vitest";
import { nextOccurrence, ruleAllowsNext } from "@/lib/invoices/recurrence";
import { zonedTimeToUtc } from "@/lib/timezone";

const TZ = "America/Toronto";

describe("nextOccurrence", () => {
  it("keeps 09:00 local across the spring DST change", () => {
    // 2026-03-02 09:00 EST = 14:00Z; DST starts 2026-03-08.
    const from = new Date("2026-03-02T14:00:00Z");
    expect(nextOccurrence(from, "WEEKLY", TZ).toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("keeps 09:00 local across the autumn DST change", () => {
    // 2026-10-26 09:00 EDT = 13:00Z; DST ends 2026-11-01.
    const from = new Date("2026-10-26T13:00:00Z");
    expect(nextOccurrence(from, "WEEKLY", TZ).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("clamps the day for short months", () => {
    const jan31 = zonedTimeToUtc({ year: 2026, month: 1, day: 31, hour: 9, minute: 0, second: 0 }, TZ);
    expect(nextOccurrence(jan31, "MONTHLY", TZ).toISOString()).toBe("2026-02-28T14:00:00.000Z");
    const leap = zonedTimeToUtc({ year: 2028, month: 1, day: 31, hour: 9, minute: 0, second: 0 }, TZ);
    expect(nextOccurrence(leap, "MONTHLY", TZ).toISOString()).toBe("2028-02-29T14:00:00.000Z");
  });

  it("steps quarterly and yearly, crossing the year end", () => {
    const nov15 = zonedTimeToUtc({ year: 2026, month: 11, day: 15, hour: 9, minute: 0, second: 0 }, TZ);
    expect(nextOccurrence(nov15, "QUARTERLY", TZ).toISOString()).toBe("2027-02-15T14:00:00.000Z");
    expect(nextOccurrence(nov15, "YEARLY", TZ).toISOString()).toBe("2027-11-15T14:00:00.000Z");
  });

  it("uses the client's own local date, not the UTC date", () => {
    // 2026-01-31 23:30 in Vancouver is already Feb 1 in UTC.
    const from = new Date("2026-02-01T07:30:00Z");
    expect(nextOccurrence(from, "MONTHLY", "America/Vancouver").toISOString()).toBe("2026-03-01T07:30:00.000Z");
  });
});

describe("ruleAllowsNext", () => {
  const at = new Date("2026-06-01T00:00:00Z");
  it("stops after the occurrence count", () => {
    expect(ruleAllowsNext({ endDate: null, occurrenceCount: 3, generatedCount: 2 }, at)).toBe(true);
    expect(ruleAllowsNext({ endDate: null, occurrenceCount: 3, generatedCount: 3 }, at)).toBe(false);
  });
  it("stops after the end date", () => {
    expect(ruleAllowsNext({ endDate: new Date("2026-05-31T00:00:00Z"), occurrenceCount: null, generatedCount: 9 }, at)).toBe(false);
    expect(ruleAllowsNext({ endDate: new Date("2026-06-01T00:00:00Z"), occurrenceCount: null, generatedCount: 9 }, at)).toBe(true);
  });
  it("is open-ended without either", () => {
    expect(ruleAllowsNext({ endDate: null, occurrenceCount: null, generatedCount: 500 }, at)).toBe(true);
  });
});
