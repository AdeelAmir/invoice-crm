"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { adminAlertEmail } from "@/lib/agent/recipients";
import { sendDirectEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { agentConfig } from "@/lib/config";

export type SettingsResult = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

// Where escalations and failure alerts are sent. Empty = the login email.
export async function saveNotificationEmailAction(value: string): Promise<SettingsResult> {
  const admin = await requireAdmin();
  const trimmed = value.trim();
  const parsed = trimmed === "" ? { success: true as const, data: null } : email.safeParse(trimmed);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address", fieldErrors: { notificationEmail: "Enter a valid email address" } };
  await prisma.admin.update({ where: { id: admin.id }, data: { notificationEmail: parsed.data } });
  revalidatePath("/dashboard/settings");
  return { ok: true, message: `Saved. Alerts will be sent to ${parsed.data ?? admin.email}.` };
}

export async function sendTestEmailAction(): Promise<SettingsResult> {
  await requireAdmin();
  const to = await adminAlertEmail();
  if (!to) return { ok: false, message: "No notification email is set" };
  const { businessName, appUrl } = agentConfig();
  const rendered = renderEmail({
    kind: "ESCALATION",
    brand: businessName,
    message: `This is a test from ${businessName}.\n\nEscalations (disputes, refund requests, suspicious messages) and invoice failure alerts will be sent to ${to}.`,
    cta: { label: "Open Settings", url: `${appUrl}/dashboard/settings` },
  });
  const r = await sendDirectEmail({ to, subject: `${businessName}: test notification`, body: rendered.text, html: rendered.html });
  if (!r.ok) return { ok: false, message: `Could not send: ${r.error}` };
  if (!r.sent) return { ok: true, message: "Email sending is off (EMAIL_PROVIDER is not resend), so nothing was sent." };
  return {
    ok: true,
    message: r.deliveredTo === to ? `Test email sent to ${to}.` : `Test email for ${to} sent to the test inbox ${r.deliveredTo}.`,
  };
}

const accountSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your name").max(120),
    email,
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string(),
  })
  .refine((v) => v.newPassword === "" || v.newPassword.length >= 8, {
    path: ["newPassword"],
    message: "Use at least 8 characters",
  });

// Name, login email and (optionally) password. Needs the current password.
export async function saveAccountAction(input: z.input<typeof accountSchema>): Promise<SettingsResult> {
  const admin = await requireAdmin();
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors };
  }
  const { name, email: newEmail, currentPassword, newPassword } = parsed.data;
  const row = await prisma.admin.findUniqueOrThrow({ where: { id: admin.id } });
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    return { ok: false, message: "The current password is not correct.", fieldErrors: { currentPassword: "Not correct" } };
  }
  if (newEmail !== row.email && (await prisma.admin.findUnique({ where: { email: newEmail } }))) {
    return { ok: false, message: "Another admin already uses this email.", fieldErrors: { email: "Already in use" } };
  }
  await prisma.admin.update({
    where: { id: admin.id },
    data: { name, email: newEmail, ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}) },
  });
  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    message: newPassword ? "Account and password updated. Use the new details next time you sign in." : "Account updated.",
  };
}
