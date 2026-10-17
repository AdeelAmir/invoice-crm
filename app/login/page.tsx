import type { Metadata } from "next";
import { BellRing, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { brandName, BRAND_TAGLINE } from "@/lib/brand";
import { LogoMark } from "@/components/layout/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

const FEATURES = [
  { icon: Sparkles, title: "Invoices that send themselves", text: "One-time and recurring invoices are created and emailed on schedule." },
  { icon: BellRing, title: "Polite, persistent reminders", text: "Overdue invoices get friendly follow-ups until they are paid." },
  { icon: ShieldCheck, title: "You stay in control", text: "Disputes and refund requests are flagged for you, never decided for you." },
];

export default function LoginPage() {
  const brand = brandName();
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-32 -left-24 size-112 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 size-96 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-10" />
          <div className="leading-tight">
            <p className="text-lg font-semibold">{brand}</p>
            <p className="text-sm text-sidebar-muted">{BRAND_TAGLINE}</p>
          </div>
        </div>
        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">
            Get paid on time, <span className="text-indigo-300">without the chasing.</span>
          </h2>
          <p className="mt-4 text-sidebar-foreground">
            {brand} creates your invoices, emails your clients, follows up on late payments and answers billing questions,
            so you can focus on the work.
          </p>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                  <Icon className="size-5 text-indigo-300" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-sidebar-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-sidebar-muted">
          <CheckCircle2 className="size-4 text-emerald-400" /> Secure admin access · sessions expire automatically
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <p className="text-lg font-semibold">{brand}</p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your {brand} admin account.</p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
