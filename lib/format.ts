import { formatInZone } from "@/lib/timezone";

// Timezone used for admin-facing times (audit log, created/updated).
// Invoice dates are shown in the client's own timezone instead.
export function adminTimeZone(): string {
  return process.env.ADMIN_TIMEZONE || "America/Toronto";
}

export function formatAdminTime(date: Date): string {
  return formatInZone(date, adminTimeZone());
}

export const CHANNEL_LABELS = { EMAIL: "Email", SMS: "SMS", BOTH: "Email + SMS" } as const;

export const STATUS_LABELS = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  CREATED: "Created",
  SENT: "Sent",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
} as const;
