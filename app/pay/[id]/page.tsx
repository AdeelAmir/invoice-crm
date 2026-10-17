import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/brand";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/timezone";
import { LogoMark } from "@/components/layout/Logo";
import { PayButton } from "./PayButton";

export const metadata: Metadata = { title: "Pay invoice" };

// Public payment page (no login): the button in the invoice email leads
// here. Payments are simulated for now (test mode): paying marks the
// invoice PAID in the CRM, exactly as a gateway webhook would.
export default async function PayPage(props: PageProps<"/pay/[id]">) {
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { name: true, timezone: true } },
      lineItems: { orderBy: { position: "asc" } },
      taxes: true,
    },
  });
  if (!invoice) notFound();

  const brand = brandName();
  const tz = invoice.client.timezone;
  const money = (v: { toString(): string }) => formatMoney(v, invoice.currency);
  const payable = invoice.status === "CREATED" || invoice.status === "SENT";
  const paid = invoice.status === "PAID";
  const overdue = payable && invoice.dueAt < new Date();

  return (
    <main className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="text-lg font-semibold">{brand}</span>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
            Test mode · no card is charged
          </span>
        </header>

        <section className="surface overflow-hidden">
          <div className={paid ? "bg-emerald-600 px-7 py-7 text-white" : "bg-sidebar px-7 py-7 text-white"}>
            <p className="text-sm text-white/70">
              {paid ? "Paid" : overdue ? "Overdue" : "Amount due"} · Invoice {invoice.invoiceNumber}
            </p>
            <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
              {money(invoice.total)} <span className="text-base font-medium text-white/70">{invoice.currency}</span>
            </p>
            <p className="mt-2 text-sm text-white/70">
              Billed to {invoice.client.name} ·{" "}
              {paid && invoice.paidAt ? `Paid ${formatInZone(invoice.paidAt, tz)}` : `Due ${formatInZone(invoice.dueAt, tz, false)}`}
            </p>
          </div>

          <div className="px-7 py-5">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Items</p>
            <ul className="mt-2 divide-y">
              {invoice.lineItems.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 py-3 text-sm">
                  <span>
                    {l.description}
                    <span className="block text-xs text-muted-foreground">
                      {Number(l.quantity)} × {money(l.unitPrice)}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{money(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1.5 border-t pt-4 text-sm">
              <Row label="Subtotal" value={money(invoice.subtotal)} />
              {invoice.taxes.map((t) => (
                <Row key={t.id} label={`${t.name} (${Number(t.rate)}%)`} value={money(t.amount)} />
              ))}
              <div className="flex justify-between border-t pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {money(invoice.total)} {invoice.currency}
                </dd>
              </div>
            </dl>
          </div>

          <div className="border-t bg-muted/40 px-7 py-6">
            {paid ? (
              <div className="flex items-start gap-3 text-emerald-800">
                <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold">Payment received. Thank you!</p>
                  <p className="text-sm text-muted-foreground">A receipt has been emailed to you.</p>
                </div>
              </div>
            ) : payable ? (
              <>
                <PayButton invoiceId={invoice.id} label={`Pay ${money(invoice.total)}`} />
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5" /> Secure checkout · you will get a receipt by email
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This invoice can’t be paid online ({invoice.status.toLowerCase()}). Please contact {brand} if you have questions.
              </p>
            )}
          </div>
        </section>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Powered by {brand}
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
