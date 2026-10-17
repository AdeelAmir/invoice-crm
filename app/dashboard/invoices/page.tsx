import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { invoiceConfig } from "@/lib/config";
import { formatMoney, fromCents, toCents } from "@/lib/money";
import { formatInZone } from "@/lib/timezone";
import { STATUS_LABELS } from "@/lib/format";
import { actionFlags } from "@/lib/invoices/service";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/lib/generated/prisma/client";
import { InvoiceStatus } from "@/lib/generated/prisma/enums";
import { PageHeader } from "@/components/layout/PageHeader";
import { Pagination } from "@/components/layout/Pagination";
import { STATUS_STYLES, StatusBadge } from "@/components/invoices/StatusBadge";
import { FilterBar } from "@/components/layout/FilterBar";
import { AlertTriangle, CircleDollarSign, Clock } from "lucide-react";
import { InvoiceActions } from "@/components/invoices/InvoiceActions";
import { InvoiceRowActions } from "@/components/invoices/InvoiceRowActions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 15;
const STATUSES = Object.values(InvoiceStatus);

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function InvoicesPage(props: PageProps<"/dashboard/invoices">) {
  await requireAdmin();
  const sp = await props.searchParams;
  const status = STATUSES.find((s) => s === one(sp.status));
  const q = one(sp.q)?.trim() || undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const { maxRetries } = invoiceConfig();

  const where: Prisma.InvoiceWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" } },
            { client: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [invoices, total, byStatus] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { client: { select: { id: true, name: true, timezone: true } } },
      orderBy: [{ issueAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({
      by: ["status", "currency"],
      _count: { _all: true },
      _sum: { total: true },
    }),
  ]);

  // Live stats straight from the database. Counts cover every invoice;
  // amounts add up CAD invoices only, since currencies cannot be summed.
  const count = (s: InvoiceStatus) =>
    byStatus.filter((b) => b.status === s).reduce((acc, b) => acc + b._count._all, 0);
  const sum = (ss: InvoiceStatus[]) =>
    fromCents(
      byStatus
        .filter((b) => b.currency === "CAD" && ss.includes(b.status))
        .reduce((acc, b) => acc + toCents(b._sum.total ?? 0), 0),
    );
  const allCount = byStatus.reduce((acc, b) => acc + b._count._all, 0);

  const cards: { label: string; value: number; href: string; active: boolean; dot?: string }[] = [
    { label: "All", value: allCount, href: "/dashboard/invoices", active: !status },
    ...STATUSES.map((s) => ({
      label: STATUS_LABELS[s],
      value: count(s),
      href: `/dashboard/invoices?status=${s}`,
      active: status === s,
      dot: STATUS_STYLES[s].dot,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices are created automatically from each client's billing plan, and your AI assistant emails them. Add or edit billing on the client."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<Clock className="size-5" />}
          tone="indigo"
          label="Outstanding (CAD)"
          hint="Created and sent, not yet paid"
          value={formatMoney(sum(["CREATED", "SENT"]), "CAD")}
        />
        <Stat
          icon={<CircleDollarSign className="size-5" />}
          tone="emerald"
          label="Collected (CAD)"
          hint="Paid invoices"
          value={formatMoney(sum(["PAID"]), "CAD")}
        />
        <Stat
          icon={<AlertTriangle className="size-5" />}
          tone="red"
          label="Needs attention (CAD)"
          hint="Failed to process"
          value={formatMoney(sum(["FAILED"]), "CAD")}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-sm font-medium shadow-xs transition-colors",
              c.active ? "border-primary bg-primary text-primary-foreground" : "text-foreground hover:border-indigo-200 hover:bg-accent",
            )}
          >
            {c.dot && <span className={cn("size-2 rounded-full", c.active ? "bg-white" : c.dot)} />}
            {c.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                c.active ? "bg-white/20" : "bg-muted text-muted-foreground",
              )}
            >
              {c.value}
            </span>
          </Link>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <FilterBar
          key={status ?? "all"}
          basePath="/dashboard/invoices"
          query={q ?? ""}
          placeholder="Search by invoice number or client"
          selects={[
            {
              name: "status",
              label: "Status",
              value: status ?? "",
              options: [{ value: "", label: "All statuses" }, ...STATUSES.map((st) => ({ value: st, label: STATUS_LABELS[st] }))],
            },
          ]}
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Issue date</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Retries</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  No invoices yet. Add a client with a billing plan and its invoices appear here automatically.
                </TableCell>
              </TableRow>
            )}
            {invoices.map((inv) => {
              const flags = actionFlags(inv);
              return (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium whitespace-nowrap text-primary hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/dashboard/clients/${inv.client.id}`} className="hover:underline">
                      {inv.client.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(inv.total, inv.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatInZone(inv.issueAt, inv.client.timezone, false)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatInZone(inv.dueAt, inv.client.timezone, false)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {inv.type === "RECURRING" ? "Recurring" : "One-time"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={inv.status} stuck={flags.stuck} />
                      {inv.needsAttention && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                          Needs attention
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {inv.retryCount}/{maxRetries}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-red-700" title={inv.lastError ?? ""}>
                    {inv.lastError ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {flags.canRetry && (
                        <InvoiceActions
                          invoiceId={inv.id}
                          invoiceNumber={inv.invoiceNumber}
                          canRetry
                          canGenerate={false}
                          compact
                        />
                      )}
                      <InvoiceRowActions invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Pagination
          page={page}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          total={total}
          basePath="/dashboard/invoices"
          params={{ q, status }}
        />
      </div>
    </>
  );
}

const TONES = {
  indigo: "bg-indigo-50 text-indigo-600",
  emerald: "bg-emerald-50 text-emerald-600",
  red: "bg-red-50 text-red-600",
};

function Stat({
  icon,
  label,
  hint,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: string;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="surface flex items-center gap-4 p-5">
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
