import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { brandName, BRAND_TAGLINE } from "@/lib/brand";
import { LogoMark } from "./Logo";
import { SidebarNav } from "./SidebarNav";

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center gap-3 px-5">
        <LogoMark />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-white">{brandName()}</p>
          <p className="text-xs text-sidebar-muted">{BRAND_TAGLINE}</p>
        </div>
      </div>
      <p className="px-5 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">Workspace</p>
      {/* The active link depends on the URL, known only at request time. */}
      <Suspense fallback={<SidebarNav pathname={null} />}>
        <SidebarNav />
      </Suspense>
      <div className="mt-auto p-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="size-4 text-indigo-300" /> AI billing assistant
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-sidebar-muted">
            Sends invoices, receipts and reminders, answers clients and flags disputes for you.
          </p>
        </div>
      </div>
    </aside>
  );
}
