import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { badRequest } from "@/lib/api";
import { handlePaymentEvent, verifySignature } from "@/lib/invoices/webhook";

// POST /api/webhooks/payment
// header: x-webhook-signature: sha256=<HMAC-SHA256 of the raw body with PAYMENT_WEBHOOK_SECRET>
// body:   { id, type: "invoice.paid" | "invoice.payment_failed",
//           data: { invoiceId? | gatewayInvoiceId?, reason? } }
// Repeated deliveries of the same event id are acknowledged and ignored.
const eventSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.enum(["invoice.paid", "invoice.payment_failed"]),
  data: z
    .object({
      invoiceId: z.number().int().positive().optional(),
      gatewayInvoiceId: z.string().trim().min(1).max(100).optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .refine((d) => d.invoiceId || d.gatewayInvoiceId, "invoiceId or gatewayInvoiceId is required"),
});

export async function POST(request: Request) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "PAYMENT_WEBHOOK_SECRET is not configured" }, { status: 500 });
  }
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-webhook-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest("Body must be JSON");
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid event", z.flattenError(parsed.error));

  const result = await handlePaymentEvent(parsed.data);
  if (!result.found) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  revalidatePath("/dashboard/invoices", "layout");
  revalidatePath("/dashboard/clients", "layout");
  return NextResponse.json({ received: true, ...result });
}
