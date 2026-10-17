import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "@/lib/auth/token";

export async function createSession(admin: { id: number; email: string }): Promise<void> {
  const token = await signSession({ sub: String(admin.id), email: admin.email });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// The signed-in admin, re-checked against the database on every request,
// so a deleted admin loses access even with a valid token.
export const getAdmin = cache(async () => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const id = Number(session.sub);
  if (!Number.isInteger(id)) return null;
  return prisma.admin.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
});

// Call at the top of every protected page and server action.
export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) redirect("/login");
  return admin;
}
