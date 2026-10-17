import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { adminAlertEmail } from "@/lib/agent/recipients";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountForm, NotificationForm } from "@/components/settings/SettingsForms";

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const row = await prisma.admin.findUniqueOrThrow({ where: { id: admin.id }, select: { notificationEmail: true } });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Your admin account and where Ledgerly sends you alerts." />
      <NotificationForm
        current={row.notificationEmail ?? ""}
        loginEmail={admin.email}
        effective={await adminAlertEmail()}
      />
      <AccountForm name={admin.name} email={admin.email} />
    </div>
  );
}
