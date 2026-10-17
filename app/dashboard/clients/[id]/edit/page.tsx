import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";
import { updateClientAction } from "../../actions";
import { planOf } from "@/lib/invoices/plans";

export default async function EditClientPage(props: PageProps<"/dashboard/clients/[id]/edit">) {
  await requireAdmin();
  const id = Number((await props.params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();
  const plan = planOf(client);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Edit ${client.name}`}
        description="Changing the billing plan stops the old schedule and starts the new one. Invoices already sent are not changed."
      />
      <ClientForm
        action={updateClientAction.bind(null, client.id)}
        cancelHref={`/dashboard/clients/${client.id}`}
        submitLabel="Save changes"
        initial={{
          name: client.name,
          email: client.email,
          phone: client.phone,
          addressLine1: client.addressLine1,
          addressLine2: client.addressLine2 ?? "",
          city: client.city,
          province: client.province,
          postalCode: client.postalCode,
          country: client.country,
          timezone: client.timezone,
          preferredChannel: client.preferredChannel,
          smsConsent: client.smsConsent,
          billingType: plan.type,
          billingDescription: plan.description ?? "",
          billingAmount: plan.amount ?? "",
          billingDate: plan.date ?? "",
          billingTermsDays: String(plan.termsDays ?? 15),
        }}
      />
    </div>
  );
}
