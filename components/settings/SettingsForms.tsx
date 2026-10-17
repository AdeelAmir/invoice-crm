"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Loader2, Save, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveAccountAction,
  saveNotificationEmailAction,
  sendTestEmailAction,
  type SettingsResult,
} from "@/app/dashboard/settings/actions";

function useAction() {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = (action: () => Promise<SettingsResult>, onOk?: () => void) =>
    startTransition(async () => {
      try {
        const r = await action();
        setErrors(r.fieldErrors ?? {});
        if (r.ok) {
          toast.success(r.message);
          onOk?.();
        } else toast.error(r.message);
      } catch {
        toast.error("The request failed. Check that you are still signed in.");
      }
    });
  return { pending, errors, run };
}

function Card({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</span>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const fieldError = (errors: Record<string, string>, key: string) =>
  errors[key] && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>;

export function NotificationForm({
  current,
  loginEmail,
  effective,
}: {
  current: string;
  loginEmail: string;
  effective: string;
}) {
  const [value, setValue] = useState(current);
  const save = useAction();
  const test = useAction();

  return (
    <Card
      icon={<BellRing className="size-5" />}
      title="Notification email"
      text="Escalations from your billing assistant (disputes, refund requests, suspicious messages) and invoice failure alerts are sent here."
    >
      <Label htmlFor="notificationEmail">Send alerts to</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="notificationEmail"
          type="email"
          value={value}
          placeholder={loginEmail}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button disabled={save.pending} onClick={() => save.run(() => saveNotificationEmailAction(value))}>
          {save.pending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      </div>
      {fieldError(save.errors, "notificationEmail")}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Leave empty to use your login email ({loginEmail}). Alerts currently go to <span className="font-medium text-foreground">{effective}</span>.
      </p>

      <Button variant="outline" size="sm" className="mt-4" disabled={test.pending} onClick={() => test.run(() => sendTestEmailAction())}>
        {test.pending ? <Loader2 className="animate-spin" /> : <Send />} Send test email
      </Button>
    </Card>
  );
}

export function AccountForm({ name, email }: { name: string; email: string }) {
  const [form, setForm] = useState({ name, email, currentPassword: "", newPassword: "" });
  const { pending, errors, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card icon={<UserRound className="size-5" />} title="Account" text="Your name, sign-in email and password.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="acc-name">Name</Label>
          <Input id="acc-name" className="mt-2" value={form.name} onChange={set("name")} />
          {fieldError(errors, "name")}
        </div>
        <div>
          <Label htmlFor="acc-email">Sign-in email</Label>
          <Input id="acc-email" type="email" className="mt-2" value={form.email} onChange={set("email")} />
          {fieldError(errors, "email")}
        </div>
        <div>
          <Label htmlFor="acc-new">New password (optional)</Label>
          <Input id="acc-new" type="password" className="mt-2" autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} placeholder="Leave empty to keep it" />
          {fieldError(errors, "newPassword")}
        </div>
        <div>
          <Label htmlFor="acc-current">Current password</Label>
          <Input id="acc-current" type="password" className="mt-2" autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} placeholder="Required to save" />
          {fieldError(errors, "currentPassword")}
        </div>
      </div>
      <Button className="mt-5" disabled={pending} onClick={() => run(() => saveAccountAction(form), () => setForm((f) => ({ ...f, currentPassword: "", newPassword: "" })))}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} Save account
      </Button>
    </Card>
  );
}
