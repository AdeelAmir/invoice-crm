"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { CANADIAN_PROVINCES } from "@/lib/tax";
import { COUNTRIES, PAYMENT_TERMS, type ClientFormValues } from "@/lib/validation/client";
import { CalendarClock, Repeat, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientFormState } from "@/app/dashboard/clients/actions";

const SELECT = "select w-full";

const TIMEZONES = [
  "America/Toronto",
  "America/Montreal",
  "America/Halifax",
  "America/St_Johns",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Whitehorse",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Karachi",
];

const EMPTY: ClientFormValues = {
  name: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "QC",
  postalCode: "",
  country: "CA",
  timezone: "America/Toronto",
  preferredChannel: "EMAIL",
  smsConsent: false,
  billingType: "ONE_TIME",
  billingDescription: "",
  billingAmount: "",
  billingDate: "",
  billingTermsDays: "15",
};

export function ClientForm({
  action,
  initial,
  cancelHref,
  submitLabel,
}: {
  action: (state: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  initial?: ClientFormValues;
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = state.values ?? initial ?? EMPTY;
  const [country, setCountry] = useState(v.country);
  const err = (f: keyof ClientFormValues) => state.errors?.[f]?.[0];
  // Re-mount the fields when the server returns values, so they show them.
  const key = JSON.stringify(state.values ?? null);

  return (
    <form action={formAction} className="space-y-6" key={key} noValidate>
      {state.message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      <Section title="Contact">
        <Field id="name" label="Name" error={err("name")}>
          <Input id="name" name="name" defaultValue={v.name} required />
        </Field>
        <Field id="email" label="Billing email" error={err("email")}>
          <Input id="email" name="email" type="email" defaultValue={v.email} required />
        </Field>
        <Field id="phone" label="Phone" hint="International format, e.g. +15145550123" error={err("phone")}>
          <Input id="phone" name="phone" defaultValue={v.phone} required />
        </Field>
        <Field id="timezone" label="Timezone" error={err("timezone")}>
          <select id="timezone" name="timezone" defaultValue={v.timezone} className={SELECT}>
            {!TIMEZONES.includes(v.timezone) && <option value={v.timezone}>{v.timezone}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <BillingSection values={v} country={country} err={err} />

      <Section title="Billing address">
        <Field id="addressLine1" label="Address line 1" error={err("addressLine1")} wide>
          <Input id="addressLine1" name="addressLine1" defaultValue={v.addressLine1} required />
        </Field>
        <Field id="addressLine2" label="Address line 2 (optional)" error={err("addressLine2")} wide>
          <Input id="addressLine2" name="addressLine2" defaultValue={v.addressLine2} />
        </Field>
        <Field id="city" label="City" error={err("city")}>
          <Input id="city" name="city" defaultValue={v.city} required />
        </Field>
        <Field id="country" label="Country" error={err("country")}>
          <select
            id="country"
            name="country"
            defaultValue={v.country}
            className={SELECT}
            onChange={(e) => setCountry(e.target.value)}
          >
            {Object.entries(COUNTRIES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="province"
          label={country === "CA" ? "Province" : "State / region"}
          hint={country === "CA" ? "Sets the sales tax (QC: GST + QST)" : undefined}
          error={err("province")}
        >
          {country === "CA" ? (
            <select id="province" name="province" defaultValue={v.province} className={SELECT}>
              {Object.entries(CANADIAN_PROVINCES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          ) : (
            <Input id="province" name="province" defaultValue={v.country === country ? v.province : ""} />
          )}
        </Field>
        <Field id="postalCode" label="Postal / ZIP code" error={err("postalCode")}>
          <Input id="postalCode" name="postalCode" defaultValue={v.postalCode} required />
        </Field>
      </Section>

      <Section title="Notifications">
        <Field id="preferredChannel" label="Preferred notification channel" error={err("preferredChannel")}>
          <select id="preferredChannel" name="preferredChannel" defaultValue={v.preferredChannel} className={SELECT}>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="BOTH">Both (Email + SMS)</option>
          </select>
        </Field>
        <Field id="smsConsent" label="SMS consent" error={err("smsConsent")}>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              id="smsConsent"
              name="smsConsent"
              type="checkbox"
              defaultChecked={v.smsConsent}
              className="size-4 accent-[var(--primary)]"
            />
            The client agreed to receive SMS
          </label>
        </Field>
      </Section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button asChild variant="outline">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="surface p-5">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

const BILLING_TYPES = [
  { value: "ONE_TIME", label: "One-time" },
  { value: "MONTHLY", label: "Recurring (monthly)" },
] as const;

const TERM_LABEL = (d: number) => (d === 0 ? "Due on receipt" : `Net ${d} (due in ${d} days)`);

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// How this client is billed. The CRM turns it into invoices: one on the
// date (one-time), or one on the date and then every month on that day.
function BillingSection({
  values,
  country,
  err,
}: {
  values: ClientFormValues;
  country: string;
  err: (f: keyof ClientFormValues) => string | undefined;
}) {
  // Every client is billed one way or the other; a client saved earlier
  // without a plan starts on one-time.
  const [type, setType] = useState(values.billingType === "MONTHLY" ? "MONTHLY" : "ONE_TIME");
  const [amount, setAmount] = useState(values.billingAmount);
  const [date, setDate] = useState(() => values.billingDate || new Date().toLocaleDateString("en-CA"));
  const currency = country === "US" ? "USD" : "CAD";
  const today = new Date().toLocaleDateString("en-CA");
  const day = Number(date.slice(8, 10));
  const nice = date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", { dateStyle: "medium" }) : "";
  const amountText = Number(amount) > 0 ? `${currency} ${Number(amount).toFixed(2)} + tax` : "the amount";

  return (
    <fieldset className="surface p-5">
      <legend className="px-1 text-sm font-semibold">Billing</legend>
      <input type="hidden" name="billingType" value={type} />
      <div className="inline-flex flex-wrap rounded-lg border bg-muted p-1">
        {BILLING_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              type === t.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {err("billingType") && <p className="mt-1 text-xs text-red-600">{err("billingType")}</p>}

      <>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field id="billingDescription" label="Service / description" error={err("billingDescription")} wide>
            <Input
              id="billingDescription"
              name="billingDescription"
              defaultValue={values.billingDescription}
              placeholder={type === "MONTHLY" ? "e.g. Website maintenance, monthly plan" : "e.g. Logo and brand identity design"}
            />
          </Field>
          <Field id="billingAmount" label={`Amount (${currency}, before tax)`} error={err("billingAmount")}>
            <Input
              id="billingAmount"
              name="billingAmount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field
            id="billingDate"
            label={type === "MONTHLY" ? "First invoice date" : "Invoice date"}
            hint={type === "MONTHLY" ? "Then every month on the same day" : "The invoice is created and emailed on this day"}
            error={err("billingDate")}
          >
            <DateInput
              id="billingDate"
              name="billingDate"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field id="billingTermsDays" label="Payment terms" error={err("billingTermsDays")}>
            <select id="billingTermsDays" name="billingTermsDays" defaultValue={values.billingTermsDays || "15"} className={SELECT}>
              {PAYMENT_TERMS.map((d) => (
                <option key={d} value={d}>
                  {TERM_LABEL(d)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex gap-2.5 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
          {date && date > today ? (
            <CalendarClock className="mt-0.5 size-4 shrink-0" />
          ) : type === "MONTHLY" ? (
            <Repeat className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Send className="mt-0.5 size-4 shrink-0" />
          )}
          <p>
            {type === "MONTHLY"
              ? `An invoice for ${amountText} is created ${date <= today ? "today" : `on ${nice}`}, then on the ${ordinal(day)} of every month. `
              : `One invoice for ${amountText} is created ${date <= today ? "today" : `on ${nice}`}. `}
            Your assistant emails each invoice, sends reminders if it is not paid on time, and a receipt once it is paid.
          </p>
        </div>
      </>
    </fieldset>
  );
}
