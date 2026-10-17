import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { invoiceConfig } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/timezone";
import { CHANNEL_LABELS, formatAdminTime } from "@/lib/format";
import { actionFlags } from "@/lib/invoices/service";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/invoices/StatusBadge";
import { InvoiceActions } from "@/components/invoices/InvoiceActions";
import { SimulateReply } from "@/components/invoices/SimulateReply";
import { ResolveEscalation } from "@/components/invoices/ResolveEscalation";
import { paymentLink } from "@/lib/agent/emails";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function InvoicePage(props: PageProps<"/dashboard/invoices/[id]">) {
  await requireAdmin();
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      lineItems: { orderBy: { position: "asc" } },
      taxes: true,
      recurringRule: true,
      parent: { select: { id: true, invoiceNumber: true } },
      next: { select: { id: true, invoiceNumber: true } },
      auditLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      emails: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      agentTasks: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 },
    },
  });
  if (!invoice) notFound();

  const { maxRetries, reminderMax } = invoiceConfig();
  const consoleWorkspace = process.env.AGENT_CONSOLE_WORKSPACE || "default";
  const flags = actionFlags(invoice);
  const tz = invoice.client.timezone;
  const money = (v: { toString(): string }) => formatMoney(v, invoice.currency);
  const justCreated = (await props.searchParams).created === "1";

  return (
    <>
      <Link
        href="/dashboard/invoices"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All invoices
      </Link>
      {justCreated && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-medium">Invoice {invoice.invoiceNumber} created.</span>{" "}
            {invoice.status === "PENDING"
              ? "It is scheduled and will be emailed automatically on its issue date."
              : "Your assistant is emailing it to the client now. Refresh in a few seconds to see the email below."}
          </p>
        </div>
      )}
      <PageHeader
        title={invoice.invoiceNumber}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={invoice.status} stuck={flags.stuck} />
            <span>
              {invoice.type === "RECURRING" ? "Recurring" : "One-time"} invoice for{" "}
              <Link href={`/dashboard/clients/${invoice.client.id}`} className="text-primary hover:underline">
                {invoice.client.name}
              </Link>
            </span>
          </span>
        }
        actions={
          <InvoiceActions
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            canRetry={flags.canRetry}
            canGenerate={flags.canGenerate}
            manualStatuses={flags.manualStatuses}
          />
        }
      />

      {invoice.status === "FAILED" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">
            Processing failed ({invoice.errorType === "PERMANENT" ? "permanent" : "temporary"} error):{" "}
            {invoice.lastError}
          </p>
          <p className="mt-1">
            {invoice.retryCount >= maxRetries
              ? `Retry limit reached (${invoice.retryCount} of ${maxRetries}). A developer alert was raised; the invoice can only be cancelled.`
              : invoice.errorType === "PERMANENT"
                ? "Fix the data (for example the client's email) and press Retry."
                : `Attempt ${invoice.retryCount} of ${maxRetries}.${
                    invoice.nextRetryAt ? ` Next automatic retry after ${formatAdminTime(invoice.nextRetryAt)}.` : ""
                  } You can also retry now.`}
          </p>
        </div>
      )}

      {invoice.needsAttention && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Needs attention: the agent escalated this conversation to you</p>
              <p className="mt-1">
                {invoice.escalatedAt ? `Escalated ${formatAdminTime(invoice.escalatedAt)}. ` : ""}
                Read the escalation email and the conversation below, then follow up with the client yourself.
              </p>
            </div>
          </div>
          <ResolveEscalation invoiceId={invoice.id} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="surface">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Line items</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lineItems.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity.toString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.lineTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <dl className="space-y-1 border-t px-4 py-3 text-sm">
              <Row label="Subtotal" value={money(invoice.subtotal)} />
              {invoice.taxes.length === 0 && <Row label="Tax" value="No Canadian tax (client outside Canada)" />}
              {invoice.taxes.map((t) => (
                <Row key={t.id} label={`${t.name} (${Number(t.rate)}%)`} value={money(t.amount)} />
              ))}
              <Row label={`Total (${invoice.currency})`} value={money(invoice.total)} strong />
            </dl>
          </section>

          <section className="surface">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Emails &amp; conversation ({invoice.emails.length})</h2>
            <ol className="divide-y">
              {invoice.emails.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No emails yet. The agent sends the invoice email once the invoice is created.
                </li>
              )}
              {invoice.emails.map((e) => (
                <li key={e.id} className={`px-4 py-3 text-sm ${e.direction === "INBOUND" ? "bg-sky-50/60" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {e.direction === "INBOUND" ? (
                      <ArrowDownLeft className="size-4 text-sky-700" />
                    ) : (
                      <ArrowUpRight className="size-4 text-emerald-700" />
                    )}
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{e.kind}</span>
                    <span className="font-medium">{e.subject}</span>
                    <span
                      className={`ml-auto rounded px-1.5 py-0.5 text-xs ${
                        e.delivery === "FAILED"
                          ? "bg-red-100 text-red-800"
                          : e.delivery === "SENT"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-secondary text-muted-foreground"
                      }`}
                      title={e.error ?? undefined}
                    >
                      {e.delivery === "OUTBOX" ? "outbox only" : e.delivery.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.direction === "INBOUND" ? `From ${e.fromAddress}` : `To ${e.toAddress}`}
                    {e.deliveredTo && e.deliveredTo !== e.toAddress ? ` (delivered to ${e.deliveredTo})` : ""} ·{" "}
                    {formatAdminTime(e.createdAt)}
                  </p>
                  {e.error && <p className="mt-1 text-xs text-red-700">Error: {e.error}</p>}
                  {e.html ? (
                    <details className="group mt-2 overflow-hidden rounded-lg border">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                        <span className="line-clamp-1">{e.body.split("\n")[0]}</span>
                        <span className="shrink-0 text-primary group-open:hidden">View email</span>
                        <span className="hidden shrink-0 text-primary group-open:inline">Hide</span>
                      </summary>
                      <iframe
                        title={e.subject}
                        srcDoc={e.html}
                        sandbox=""
                        className="h-160 w-full border-t bg-[#f4f5fb]"
                      />
                    </details>
                  ) : (
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-sans text-sm whitespace-pre-wrap">
                      {e.body}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
            <SimulateReply invoiceId={invoice.id} clientName={invoice.client.name} />
          </section>

          <section className="surface">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Audit log</h2>
            <ol className="divide-y">
              {invoice.auditLogs.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">No entries yet.</li>
              )}
              {invoice.auditLogs.map((log) => (
                <li key={log.id} className="flex gap-3 px-4 py-3 text-sm">
                  {log.result === "SUCCESS" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="mr-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{log.step}</span>
                      {log.message}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatAdminTime(log.createdAt)} · {log.actor}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-6">
          <section className="surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Details</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Issue date" value={formatInZone(invoice.issueAt, tz)} />
              <Row label="Due date" value={formatInZone(invoice.dueAt, tz)} />
              <Row label="Payment terms" value={invoice.paymentTerms} />
              <Row label="Currency" value={invoice.currency} />
              <Row label="Gateway invoice ID" value={invoice.gatewayInvoiceId ?? "—"} mono />
              <Row label="Retries" value={`${invoice.retryCount} of ${maxRetries}`} />
              {invoice.sentAt && <Row label="Sent" value={formatAdminTime(invoice.sentAt)} />}
              {invoice.paidAt && <Row label="Paid" value={formatAdminTime(invoice.paidAt)} />}
              {(invoice.status === "SENT" || invoice.reminderCount > 0) && (
                <Row
                  label="Overdue reminders"
                  value={`${invoice.reminderCount} of ${reminderMax}${
                    invoice.lastReminderAt ? ` · last ${formatAdminTime(invoice.lastReminderAt)}` : ""
                  }`}
                />
              )}
              {invoice.simulateFailure === "TIMEOUT" && (
                <Row label="Test setting" value="First gateway call times out" />
              )}
            </dl>
          </section>

          {invoice.recurringRule && (
            <section className="surface p-4">
              <h2 className="mb-3 text-sm font-semibold">Recurring schedule</h2>
              <dl className="space-y-2 text-sm">
                <Row label="Frequency" value={invoice.recurringRule.frequency.toLowerCase()} />
                <Row label="Start" value={formatInZone(invoice.recurringRule.startDate, tz, false)} />
                <Row
                  label="Ends"
                  value={
                    invoice.recurringRule.endDate
                      ? formatInZone(invoice.recurringRule.endDate, tz, false)
                      : invoice.recurringRule.occurrenceCount
                        ? `after ${invoice.recurringRule.occurrenceCount} invoices`
                        : "no end date"
                  }
                />
                <Row label="Generated so far" value={String(invoice.recurringRule.generatedCount)} />
                {invoice.parent && (
                  <Row
                    label="Previous"
                    value={
                      <Link href={`/dashboard/invoices/${invoice.parent.id}`} className="text-primary hover:underline">
                        {invoice.parent.invoiceNumber}
                      </Link>
                    }
                  />
                )}
                {invoice.next && (
                  <Row
                    label="Next"
                    value={
                      <Link href={`/dashboard/invoices/${invoice.next.id}`} className="text-primary hover:underline">
                        {invoice.next.invoiceNumber}
                      </Link>
                    }
                  />
                )}
              </dl>
            </section>
          )}

          <section className="surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Agent</h2>
            {hasStalledTask(invoice.agentTasks) && (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <p className="font-medium">An email is waiting to be sent.</p>
                <p className="mt-1">
                  The agent worker does not seem to be running. Start it in a second terminal with{" "}
                  <code className="rounded bg-amber-100 px-1">npm run agent:worker</code> and it is sent within seconds.
                </p>
              </div>
            )}
            <dl className="space-y-2 text-sm">
              <Row
                label="Session"
                value={
                  invoice.agentSessionId ? (
                    <a
                      href={`https://platform.claude.com/workspaces/${consoleWorkspace}/sessions/${invoice.agentSessionId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Open in Console <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              {(invoice.status === "CREATED" || invoice.status === "SENT") && (
                <Row
                  label="Payment link"
                  value={
                    <a href={paymentLink(invoice.id)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      /pay/{invoice.id}
                    </a>
                  }
                />
              )}
            </dl>
            <ul className="mt-3 space-y-1 border-t pt-3 text-xs">
              {invoice.agentTasks.length === 0 && <li className="text-muted-foreground">No agent tasks yet.</li>}
              {invoice.agentTasks.map((t) => (
                <li key={t.id} className="flex flex-wrap justify-between gap-2" title={t.lastError ?? t.result ?? ""}>
                  <span className="font-mono">{t.type}</span>
                  <span
                    className={
                      t.status === "FAILED"
                        ? "text-red-700"
                        : t.status === "DONE"
                          ? "text-emerald-700"
                          : "text-amber-700"
                    }
                  >
                    {t.status.toLowerCase()}
                    {t.attempts > 1 ? ` (${t.attempts} tries)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Client</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Name" value={invoice.client.name} />
              <Row label="Email" value={invoice.client.email} />
              <Row label="Phone" value={invoice.client.phone} />
              <Row label="Timezone" value={tz} />
              <Row
                label="Notify by"
                value={`${CHANNEL_LABELS[invoice.client.preferredChannel]}${
                  invoice.client.smsConsent ? " · SMS consent" : ""
                }`}
              />
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}

// A task still PENDING a minute after it was queued means nothing is
// working the queue: the worker polls every few seconds when it runs.
function hasStalledTask(tasks: { status: string; createdAt: Date }[]): boolean {
  const cutoff = Date.now() - 60_000;
  return tasks.some((t) => t.status === "PENDING" && t.createdAt.getTime() < cutoff);
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${strong ? "font-semibold" : ""} ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
