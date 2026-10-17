"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard/invoices", label: "Invoices", icon: FileText },
  { href: "/dashboard/clients", label: "Client Management", icon: Users },
];

function ActiveNav() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname?.startsWith(href) ?? false;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-sidebar-active text-white" : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className={cn("size-[18px]", active ? "text-indigo-300" : "text-sidebar-muted group-hover:text-white")} />
            {label}
            {active && <span className="ml-auto size-1.5 rounded-full bg-indigo-400" />}
          </Link>
        );
      })}
    </nav>
  );
}

// Without a pathname (the prerendered fallback) the links render unhighlighted.
export function SidebarNav({ pathname }: { pathname?: string | null }) {
  return pathname === undefined ? <ActiveNav /> : <NavLinks pathname={pathname} />;
}
