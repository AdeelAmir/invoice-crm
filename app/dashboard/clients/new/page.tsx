import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";
import { createClientAction } from "../actions";

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Add client"
        description="Add the client's details and how they are billed. Invoices are then created and emailed automatically."
      />
      <ClientForm action={createClientAction} cancelHref="/dashboard/clients" submitLabel="Create client" />
    </div>
  );
}
