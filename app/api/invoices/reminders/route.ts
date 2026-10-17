import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-key";
import { serializeInvoice } from "@/lib/api";
import { invoiceConfig } from "@/lib/config";
import { remindersDue } from "@/lib/invoices/reminders";

// GET /api/invoices/reminders: SENT invoices that are overdue and due for a
// reminder now (INVOICE_REMINDER_INTERVAL_DAYS apart, at most
// INVOICE_REMINDER_MAX). Claim each with POST /api/invoices/{id}/reminder
// before sending.
export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { reminderIntervalDays, reminderMax } = invoiceConfig();
  const invoices = await remindersDue();
  return NextResponse.json({
    reminderIntervalDays,
    reminderMax,
    count: invoices.length,
    invoices: invoices.map(serializeInvoice),
  });
}
