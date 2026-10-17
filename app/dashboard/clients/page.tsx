import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import type { Prisma } from "@/lib/generated/prisma/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Pagination } from "@/components/layout/Pagination";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/layout/FilterBar";
import { formatMoney } from "@/lib/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 15;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ClientsPage(props: PageProps<"/dashboard/clients">) {
  await requireAdmin();
  const sp = await props.searchParams;
  const q = one(sp.q)?.trim() || undefined;
  const state = one(sp.state) === "inactive" ? "inactive" : one(sp.state) === "all" ? "all" : "active";
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const where: Prisma.ClientWhereInput = {
    ...(state === "all" ? {} : { isActive: state === "active" }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: { _count: { select: { invoices: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.client.count({ where }),
  ]);

  return (
    <>
      <PageHeader
        title="Client Management"
        description="Your clients' billing details, timezone and contact preferences, used on every invoice."
        actions={
          <Button asChild>
            <Link href="/dashboard/clients/new">
              <Plus /> Add client
            </Link>
          </Button>
        }
      />

      <div className="surface overflow-hidden">
        <FilterBar
          key={state}
          basePath="/dashboard/clients"
          query={q ?? ""}
          placeholder="Search by name, email or city"
          selects={[
            {
              name: "state",
              label: "Status",
              value: state === "active" ? "" : state,
              options: [
                { value: "", label: "Active clients" },
                { value: "inactive", label: "Deactivated" },
                { value: "all", label: "All clients" },
              ],
            },
          ]}
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead className="text-center">Invoices</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No clients yet. Add your first client to start invoicing.
                </TableCell>
              </TableRow>
            )}
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/dashboard/clients/${c.id}`} className="flex items-center gap-3 font-medium hover:text-primary">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                      {c.name
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>{c.email}</TableCell>
                <TableCell className="whitespace-nowrap">{c.phone}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {c.city}, {c.province} · {c.country}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {c.billingType === "NONE" || !c.billingAmount ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span>
                      <span className="font-medium tabular-nums">
                        {formatMoney(c.billingAmount, c.country === "US" ? "USD" : "CAD")}
                      </span>
                      <span className="text-muted-foreground">{c.billingType === "MONTHLY" ? " / month" : " once"}</span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.timezone}</TableCell>
                <TableCell className="text-center tabular-nums">{c._count.invoices}</TableCell>
                <TableCell>
                  <span
                    className={
                      c.isActive
                        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                        : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500"
                    }
                  >
                    {c.isActive ? "Active" : "Deactivated"}
                  </span>
                </TableCell>
                <TableCell>
                  <Link href={`/dashboard/clients/${c.id}/edit`} className="text-sm text-primary hover:underline">
                    Edit
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination
          page={page}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          total={total}
          basePath="/dashboard/clients"
          params={{ q, state: state === "active" ? undefined : state }}
        />
      </div>
    </>
  );
}
