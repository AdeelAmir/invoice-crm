"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handlePaymentEvent } from "@/lib/invoices/webhook";

// Mock payment: goes through the same code as a real payment webhook, so
// the invoice becomes PAID and the receipt is queued for the agent.
export type PayResult = { ok: boolean; message: string };

export async function payInvoiceAction(invoiceId: number): Promise<PayResult> {
  const id = z.number().int().positive().parse(invoiceId);
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: { status: true } });
  if (!invoice) return { ok: false, message: "Invoice not found" };
  if (invoice.status === "PAID") return { ok: true, message: "This invoice is already paid." };
  if (invoice.status !== "CREATED" && invoice.status !== "SENT") {
    return { ok: false, message: "This invoice cannot be paid online." };
  }

  const result = await handlePaymentEvent(
    { id: `mock_pay_${id}_${randomUUID()}`, type: "invoice.paid", data: { invoiceId: id } },
    "mock-payment",
  );
  revalidatePath(`/pay/${id}`);
  revalidatePath("/dashboard/invoices", "layout");
  revalidatePath("/dashboard/clients", "layout");
  return result.found && result.status === "PAID"
    ? { ok: true, message: "Payment received. A receipt is on its way to your inbox." }
    : { ok: false, message: "The payment could not be recorded." };
}
