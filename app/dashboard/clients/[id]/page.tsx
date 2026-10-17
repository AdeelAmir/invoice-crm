import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/timezone";
import { CHANNEL_LABELS, formatAdminTime } from "@/lib/format";
import { CANADIAN_PROVINCES, taxLinesFor } from "@/lib/tax";
import { COUNTRIES } from "@/lib/validation/client";
import { planOf } from "@/lib/invoices/plans";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/invoices/StatusBadge";
import { ClientActiveToggle } from "@/components/clients/ClientActiveToggle";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function ClientPage(props: PageProps<"/dashboard/clients/[id]">) {
  await requireAdmin();
  const id = Number((await props.params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await props.searchParams;

  const client = await prisma.client.findUnique({
    where: { id },
    include: { invoices: { orderBy: [{ issueAt: "desc" }, { id: "desc" }] } },
  });
  if (!client) notFound();

  const taxes = taxLinesFor(client.country, client.province);
  const saved =
    sp.saved === "created"
      ? "Client created. Their billing plan is active."
      : sp.saved === "plan"
        ? "Changes saved. The billing plan was updated: the old schedule stopped and the new one started."
        : sp.saved === "updated"
          ? "Changes saved."
          : null;
  const plan = planOf(client);
  const nextPlanInvoice = client.invoices
    .filter((i) => i.fromClientPlan && i.status === "PENDING")
    .sort((a, b) => a.issueAt.getTime() - b.issueAt.getTime())[0];
  const planCurrency = client.country === "US" ? "USD" : "CAD";

  return (
    <>
      <Link
        href="/dashboard/clients"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All clients
      </Link>
      <PageHeader
        title={client.name}
        description={client.isActive ? "Active client" : "Deactivated: invoices are not processed"}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/dashboard/clients/${client.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <ClientActiveToggle clientId={client.id} name={client.name} isActive={client.isActive} />
          </>
        }
      />
      {saved && (
        <p className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{saved}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Billing plan</h2>
          {plan.type === "NONE" ? (
            <p className="text-sm text-muted-foreground">
              No automatic billing. Edit the client to set a one-time or monthly plan.
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <Row label="Type" value={plan.type === "MONTHLY" ? "Recurring, every month" : "One-time"} />
              <Row label="Service" value={plan.description} />
              <Row
                label="Amount"
                value={`${formatMoney(plan.amount ?? "0", planCurrency)} ${planCurrency} + tax`}
              />
              <Row
                label={plan.type === "MONTHLY" ? "Bills on" : "Invoice date"}
                value={
                  plan.date
                    ? plan.type === "MONTHLY"
                      ? `Day ${Number(plan.date.slice(8, 10))} of every month (from ${plan.date})`
                      : plan.date
                    : "—"
                }
              />
              <Row label="Payment terms" value={plan.termsDays ? `Net ${plan.termsDays}` : "Due on receipt"} />
              <Row
                label="Next invoice"
                value={
                  nextPlanInvoice ? (
                    <Link href={`/dashboard/invoices/${nextPlanInvoice.id}`} className="text-primary hover:underline">
                      {nextPlanInvoice.invoiceNumber} on {formatInZone(nextPlanInvoice.issueAt, client.timezone, false)}
                    </Link>
                  ) : plan.type === "MONTHLY" ? (
                    "Created after the current invoice is issued"
                  ) : (
                    "Already issued"
                  )
                }
              />
            </dl>
          )}
        </section>
        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Details</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Email" value={client.email} />
            <Row label="Phone" value={client.phone} />
            <Row
              label="Address"
              value={
                <>
                  {client.addressLine1}
                  {client.addressLine2 && <>, {client.addressLine2}</>}
                  <br />
                  {client.city}, {CANADIAN_PROVINCES[client.province] ?? client.province} {client.postalCode}
                  <br />
                  {COUNTRIES[client.country] ?? client.country}
                </>
              }
            />
            <Row label="Timezone" value={client.timezone} />
            <Row label="Preferred channel" value={CHANNEL_LABELS[client.preferredChannel]} />
            <Row
              label="SMS consent"
              value={client.smsConsent && client.smsConsentAt ? `Yes, since ${formatAdminTime(client.smsConsentAt)}` : "No"}
            />
            <Row
              label="Sales tax"
              value={taxes.length ? taxes.map((t) => `${t.name} ${t.ratePercent}%`).join(" + ") : "None (outside Canada)"}
            />
          </dl>
        </section>

        </div>
        <section className="surface self-start lg:col-span-2">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Invoices ({client.invoices.length})</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issue date</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No invoices for this client.
                  </TableCell>
                </TableRow>
              )}
              {client.invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatInZone(inv.issueAt, client.timezone, false)}</TableCell>
                  <TableCell>{formatInZone(inv.dueAt, client.timezone, false)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(inv.total, inv.currency)}</TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{value}</dd>
    </div>
  );
}
