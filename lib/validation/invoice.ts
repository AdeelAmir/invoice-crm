import { z } from "zod";
import { RecurrenceFrequency } from "@/lib/generated/prisma/enums";

// Body of POST /api/invoices. Money is in dollars with at most 2 decimals;
// quantity too (the columns are Decimal(…, 2)).
const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(200),
  quantity: z.number().positive().max(100_000).refine(twoDecimals, "At most 2 decimals"),
  unitPrice: z.number().positive().max(10_000_000).refine(twoDecimals, "At most 2 decimals"),
});

export const newInvoiceSchema = z
  .object({
    clientId: z.number().int().positive(),
    // When the invoice should be processed; default now.
    issueAt: z.iso.datetime({ offset: true }).optional(),
    termsDays: z.number().int().min(0).max(365).default(30),
    lineItems: z.array(lineItemSchema).min(1, "At least one line item").max(50),
    recurring: z
      .object({
        frequency: z.enum(Object.values(RecurrenceFrequency) as [RecurrenceFrequency, ...RecurrenceFrequency[]]),
        occurrenceCount: z.number().int().min(1).max(500).optional(),
        endDate: z.iso.datetime({ offset: true }).optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    const issueAt = v.issueAt ? new Date(v.issueAt) : new Date();
    if (v.recurring?.endDate && new Date(v.recurring.endDate) < issueAt) {
      ctx.addIssue({ code: "custom", path: ["recurring", "endDate"], message: "endDate must be after issueAt" });
    }
  });

export type NewInvoiceBody = z.output<typeof newInvoiceSchema>;
