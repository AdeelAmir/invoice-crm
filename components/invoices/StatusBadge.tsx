import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/generated/prisma/enums";

export const STATUS_STYLES: Record<InvoiceStatus, { badge: string; dot: string }> = {
  PENDING: { badge: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
  PROCESSING: { badge: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  CREATED: { badge: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  SENT: { badge: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "bg-indigo-500" },
  PAID: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  FAILED: { badge: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  CANCELLED: { badge: "bg-zinc-100 text-zinc-500 ring-zinc-200", dot: "bg-zinc-400" },
};

export function StatusBadge({ status, stuck = false }: { status: InvoiceStatus; stuck?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLES[status].badge,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_STYLES[status].dot)} />
      {STATUS_LABELS[status]}
      {stuck && " · stuck"}
    </span>
  );
}
