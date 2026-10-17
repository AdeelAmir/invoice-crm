"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { billingSchema, clientSchema, readClientForm, type ClientFormValues } from "@/lib/validation/client";
import { dateToColumn, planOf, samePlan, startClientPlan, stopClientPlan, todayIn, type BillingPlan } from "@/lib/invoices/plans";

export type ClientFormState = {
  values?: ClientFormValues;
  errors?: Partial<Record<keyof ClientFormValues, string[]>>;
  message?: string;
};

type Errors = NonNullable<ClientFormState["errors"]>;

// Client fields and billing plan, validated together so every problem is
// shown at once. `previousPlan` lets an unchanged plan keep a past date;
// `lastBilled` (the latest day the old plan already invoiced) keeps a
// changed plan from billing the client twice for the same day.
function parse(formData: FormData, previousPlan?: BillingPlan, lastBilled?: string | null) {
  const values = readClientForm(formData);
  const client = clientSchema.safeParse(values);
  const billing = billingSchema.safeParse(values);
  const errors: Errors = {
    ...(client.success ? {} : z.flattenError(client.error).fieldErrors),
    ...(billing.success ? {} : z.flattenError(billing.error).fieldErrors),
  };
  if (client.success && billing.success && billing.data.date) {
    const changed = !previousPlan || !samePlan(previousPlan, billing.data);
    if (changed && billing.data.date < todayIn(client.data.timezone)) {
      errors.billingDate = ["Choose today or a later date"];
    } else if (changed && lastBilled && billing.data.date <= lastBilled) {
      errors.billingDate = [
        `The current plan already billed on ${lastBilled}. Choose a later date (e.g. the next billing date) so the client is not billed twice.`,
      ];
    }
  }
  if (!client.success || !billing.success || Object.keys(errors).length > 0) {
    return { ok: false as const, values, errors };
  }
  return { ok: true as const, values, client: client.data, plan: billing.data };
}

function planColumns(plan: BillingPlan) {
  return {
    billingType: plan.type,
    billingDescription: plan.description,
    billingAmount: plan.amount,
    billingDate: plan.date ? dateToColumn(plan.date) : null,
    billingTermsDays: plan.termsDays,
  };
}

export async function createClientAction(_prev: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const admin = await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.ok) return { values: parsed.values, errors: parsed.errors, message: "Please fix the highlighted fields." };

  const client = await prisma.client.create({
    data: {
      ...parsed.client,
      ...planColumns(parsed.plan),
      smsConsentAt: parsed.client.smsConsent ? new Date() : null,
    },
  });
  // Schedule (or, for today, create and send) the first invoice.
  await startClientPlan(client.id, `admin:${admin.id}`);
  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard/invoices", "layout");
  redirect(`/dashboard/clients/${client.id}?saved=created`);
}

export async function updateClientAction(
  clientId: number,
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const admin = await requireAdmin();
  const actor = `admin:${admin.id}`;
  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) return { message: "Client not found." };

  const previousPlan = planOf(existing);
  const lastIssued = await prisma.invoice.findFirst({
    where: { clientId, fromClientPlan: true, status: { notIn: ["PENDING", "CANCELLED"] } },
    orderBy: { issueAt: "desc" },
    select: { issueAt: true },
  });
  const parsed = parse(formData, previousPlan, lastIssued ? todayIn(existing.timezone, lastIssued.issueAt) : null);
  if (!parsed.ok) return { values: parsed.values, errors: parsed.errors, message: "Please fix the highlighted fields." };

  // Keep the original consent time while consent stands; record a new one
  // when it is given again; clear it when withdrawn.
  const smsConsentAt = !parsed.client.smsConsent
    ? null
    : existing.smsConsent
      ? existing.smsConsentAt
      : new Date();
  const planChanged = !samePlan(previousPlan, parsed.plan);
  await prisma.client.update({
    where: { id: clientId },
    data: { ...parsed.client, ...planColumns(parsed.plan), smsConsentAt },
  });
  if (planChanged) {
    // Replace the schedule: stop the old one, then start the new plan.
    await stopClientPlan(clientId, actor);
    await startClientPlan(clientId, actor);
  }
  revalidatePath("/dashboard/clients", "layout");
  revalidatePath("/dashboard/invoices", "layout");
  redirect(`/dashboard/clients/${clientId}?saved=${planChanged ? "plan" : "updated"}`);
}

export async function setClientActiveAction(
  clientId: number,
  active: boolean,
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const id = z.number().int().positive().parse(clientId);
  const { count } = await prisma.client.updateMany({ where: { id }, data: { isActive: active } });
  if (count !== 1) return { ok: false, message: "Client not found." };
  revalidatePath("/dashboard/clients", "layout");
  return {
    ok: true,
    message: active ? "Client reactivated." : "Client deactivated. Their invoices will not be processed.",
  };
}
