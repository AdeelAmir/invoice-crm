"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

// Live filters: typing in the search box (debounced) or changing a select
// updates the URL in place, and the server page re-renders the list. No
// submit button, no full page reload; the current list stays on screen
// until the new one is ready.

export type FilterSelect = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
};

export function FilterBar({
  basePath,
  query,
  placeholder,
  selects = [],
}: {
  basePath: string;
  query: string;
  placeholder: string;
  selects?: FilterSelect[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);
  const [values, setValues] = useState(() => Object.fromEntries(selects.map((s) => [s.name, s.value])));
  const first = useRef(true);

  const navigate = (q: string, vals: Record<string, string>) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    for (const [k, v] of Object.entries(vals)) if (v) params.set(k, v);
    const s = params.toString();
    startTransition(() => router.replace(s ? `${basePath}?${s}` : basePath, { scroll: false }));
  };

  // Debounce typing; selects apply immediately.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => navigate(text, values), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const setSelect = (name: string, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    navigate(text, next);
  };

  const hasFilters = text.trim() !== "" || selects.some((s) => values[s.name] !== s.options[0]?.value);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-4">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="pr-9 pl-9"
          aria-label="Search"
        />
        {pending ? (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : text ? (
          <button
            type="button"
            onClick={() => setText("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {selects.map((s) => (
        <select
          key={s.name}
          aria-label={s.label}
          value={values[s.name]}
          onChange={(e) => setSelect(s.name, e.target.value)}
          className="select"
        >
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            const reset = Object.fromEntries(selects.map((s) => [s.name, s.options[0]?.value ?? ""]));
            setText("");
            setValues(reset);
            navigate("", reset);
          }}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
