import { prisma } from "@/lib/db";

// Where admin emails (escalations, failure alerts) go, first match wins:
//   1. the notification email saved on the Settings page,
//   2. ADMIN_ALERT_EMAIL in .env,
//   3. the admin's login email (then ADMIN_EMAIL when no admin exists yet).
export async function adminAlertEmail(): Promise<string> {
  const admin = await prisma.admin.findFirst({
    orderBy: { id: "asc" },
    select: { email: true, notificationEmail: true },
  });
  return (
    admin?.notificationEmail?.trim() ||
    process.env.ADMIN_ALERT_EMAIL?.trim() ||
    admin?.email ||
    process.env.ADMIN_EMAIL?.trim() ||
    ""
  );
}
