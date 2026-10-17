import type { InvoiceStatus } from "@/lib/generated/prisma/enums";

type TransitionTable = Record<InvoiceStatus, readonly InvoiceStatus[]>;

// What the automation (agent / API) may move an invoice to. PENDING ->
// PROCESSING is missing on purpose: only the atomic claim may do that.
export const SYSTEM_TRANSITIONS: TransitionTable = {
  PENDING: ["CANCELLED"],
  PROCESSING: ["CREATED", "FAILED", "PENDING"],
  CREATED: ["SENT", "PAID", "FAILED", "CANCELLED"],
  SENT: ["PAID", "FAILED", "CANCELLED"],
  FAILED: ["PENDING", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

// What an admin may set by hand on the invoice page. Retry and Generate
// now are separate actions that run the processing flow instead.
export const ADMIN_TRANSITIONS: TransitionTable = {
  PENDING: ["CANCELLED"],
  PROCESSING: [],
  CREATED: ["PAID", "CANCELLED"],
  SENT: ["PAID", "CANCELLED"],
  FAILED: ["CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

export function canTransition(
  table: TransitionTable,
  from: InvoiceStatus,
  to: InvoiceStatus,
): boolean {
  return table[from].includes(to);
}

// Exponential backoff before the next automatic retry: base, 2x, 4x, ...
export function retryDelaySeconds(retryCount: number, baseSeconds: number): number {
  return baseSeconds * 2 ** Math.max(0, retryCount - 1);
}
