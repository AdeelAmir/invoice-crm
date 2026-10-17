import Link from "next/link";
import { cn } from "@/lib/utils";

// Prev / next links that keep the current filters in the query string.
export function Pagination({
  page,
  pageCount,
  total,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const link = (p: number, label: string, disabled: boolean) => (
    <Link
      href={disabled ? "#" : href(p)}
      aria-disabled={disabled}
      className={cn(
        "rounded-lg border bg-card px-3 py-1.5 text-sm font-medium shadow-xs",
        disabled ? "pointer-events-none text-muted-foreground opacity-50" : "text-foreground hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex items-center justify-between border-t px-5 py-3.5 text-sm text-muted-foreground">
      <span>
        {total} result{total === 1 ? "" : "s"} · page {page} of {Math.max(pageCount, 1)}
      </span>
      <div className="flex gap-2">
        {link(page - 1, "Previous", page <= 1)}
        {link(page + 1, "Next", page >= pageCount)}
      </div>
    </div>
  );
}
