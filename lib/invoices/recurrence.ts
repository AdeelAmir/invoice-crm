import type { RecurrenceFrequency } from "@/lib/generated/prisma/enums";
import { wallTimeIn, zonedTimeToUtc } from "@/lib/timezone";

const MONTHS: Record<Exclude<RecurrenceFrequency, "WEEKLY">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Next occurrence of `from`, stepped in the client's own timezone: 09:00 in
// Montreal stays 09:00 after a DST change, and Jan 31 + 1 month is Feb 28/29.
export function nextOccurrence(from: Date, frequency: RecurrenceFrequency, timeZone: string): Date {
  const w = wallTimeIn(from, timeZone);
  if (frequency === "WEEKLY") {
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + 7));
    return zonedTimeToUtc(
      { ...w, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
      timeZone,
    );
  }
  const total = w.year * 12 + (w.month - 1) + MONTHS[frequency];
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(w.day, daysInMonth(year, month));
  return zonedTimeToUtc({ ...w, year, month, day }, timeZone);
}

export type RuleState = {
  endDate: Date | null;
  occurrenceCount: number | null;
  generatedCount: number;
};

// Whether the rule allows another invoice issued at `nextIssueAt`.
export function ruleAllowsNext(rule: RuleState, nextIssueAt: Date): boolean {
  if (rule.occurrenceCount !== null && rule.generatedCount >= rule.occurrenceCount) return false;
  if (rule.endDate !== null && nextIssueAt.getTime() > rule.endDate.getTime()) return false;
  return true;
}
