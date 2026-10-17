"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { clearAttempts, isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { createSession, deleteSession } from "@/lib/auth/session";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") ?? "" });
  if (!parsed.success) return { error: "Enter a valid email and your password.", email };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${parsed.data.email}|${ip}`;
  if (isRateLimited(key)) {
    return { error: "Too many failed attempts. Try again in 15 minutes.", email };
  }

  const admin = await prisma.admin.findUnique({ where: { email: parsed.data.email } });
  const ok = await verifyPassword(parsed.data.password, admin?.passwordHash ?? null);
  if (!admin || !ok) {
    recordFailedAttempt(key);
    // Same message for an unknown email and a wrong password.
    return { error: "Invalid email or password.", email };
  }

  clearAttempts(key);
  await createSession(admin);
  redirect("/dashboard/invoices");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
