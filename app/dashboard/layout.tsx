import { Suspense } from "react";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { brandName } from "@/lib/brand";
import { logout } from "@/app/login/actions";

// The shell (sidebar, header frame) is static; the session read streams in
// behind a Suspense boundary, as Cache Components requires. Every page and
// server action checks the session again on its own.
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card/85 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3 md:hidden">
            <LogoMark className="size-8" />
            <span className="font-semibold">{brandName()}</span>
            <Link href="/dashboard/invoices" className="text-sm text-muted-foreground hover:text-foreground">
              Invoices
            </Link>
            <Link href="/dashboard/clients" className="text-sm text-muted-foreground hover:text-foreground">
              Clients
            </Link>
          </div>
          <div className="hidden md:block" />
          <Suspense fallback={<div className="h-9 w-48 rounded-lg bg-muted" />}>
            <AdminMenu />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-350 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

async function AdminMenu() {
  const admin = await requireAdmin();
  const initials = admin.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-sm font-medium">{admin.name}</p>
        <p className="text-xs text-muted-foreground">{admin.email}</p>
      </div>
      <span className="flex size-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
        {initials}
      </span>
      <Button asChild variant="ghost" size="sm" title="Settings">
        <Link href="/dashboard/settings">
          <Settings /> <span className="hidden sm:inline">Settings</span>
        </Link>
      </Button>
      <form action={logout}>
        <Button type="submit" variant="ghost" size="sm" title="Sign out">
          <LogOut /> <span className="hidden sm:inline">Sign out</span>
        </Button>
      </form>
    </div>
  );
}
