import { z } from "zod";
import { CANADIAN_PROVINCES } from "@/lib/tax";
import { isValidTimeZone } from "@/lib/timezone";

export const COUNTRIES: Record<string, string> = {
  CA: "Canada",
  US: "United States",
  GB: "United Kingdom",
  FR: "France",
  AE: "United Arab Emirates",
  PK: "Pakistan",
};

const CA_POSTAL = /^([A-Za-z]\d[A-Za-z])[ -]?(\d[A-Za-z]\d)$/;
const US_ZIP = /^\d{5}(-\d{4})?$/;

export const clientSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +15145550123"),
    addressLine1: z.string().trim().min(3, "Address is required").max(200),
    addressLine2: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === "" ? null : v)),
    city: z.string().trim().min(2, "City is required").max(100),
    province: z.string().trim().toUpperCase().min(2, "Province / state is required").max(50),
    postalCode: z.string().trim().min(3, "Postal code is required").max(20),
    country: z.enum(Object.keys(COUNTRIES) as [string, ...string[]], "Choose a country"),
    timezone: z.string().refine(isValidTimeZone, "Choose a valid timezone"),
    preferredChannel: z.enum(["EMAIL", "SMS", "BOTH"], "Choose a channel"),
    smsConsent: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.country === "CA") {
      if (!(v.province in CANADIAN_PROVINCES)) {
        ctx.addIssue({ code: "custom", path: ["province"], message: "Choose a Canadian province" });
      }
      if (!CA_POSTAL.test(v.postalCode)) {
        ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Canadian postal code, e.g. H2X 1Y4" });
      }
    }
    if (v.country === "US" && !US_ZIP.test(v.postalCode)) {
      ctx.addIssue({ code: "custom", path: ["postalCode"], message: "US ZIP code, e.g. 10001" });
    }
    if ((v.preferredChannel === "SMS" || v.preferredChannel === "BOTH") && !v.smsConsent) {
      ctx.addIssue({
        code: "custom",
        path: ["smsConsent"],
        message: "SMS (or both) as the preferred channel needs the client's SMS consent",
      });
    }
  })
  .transform((v) => {
    const m = v.country === "CA" ? CA_POSTAL.exec(v.postalCode) : null;
    return { ...v, postalCode: m ? `${m[1]} ${m[2]}`.toUpperCase() : v.postalCode };
  });

export type ClientInput = z.output<typeof clientSchema>;

export const PAYMENT_TERMS = [0, 7, 15, 30, 45, 60] as const;

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

// The billing plan section of the client form: every client is billed
// one-time or monthly. That the date is not in the past is checked by the
// action, which knows the client's timezone.
export const billingSchema = z
  .object({
    billingType: z.enum(["ONE_TIME", "MONTHLY"], "Choose one-time or recurring billing"),
    billingDescription: z.string().trim(),
    billingAmount: z.string().trim(),
    billingDate: z.string().trim(),
    billingTermsDays: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.billingDescription.length < 2 || v.billingDescription.length > 200) {
      ctx.addIssue({ code: "custom", path: ["billingDescription"], message: "Describe what you are billing (2 to 200 characters)" });
    }
    const amount = Number(v.billingAmount);
    if (v.billingAmount === "" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 || !twoDecimals(amount)) {
      ctx.addIssue({ code: "custom", path: ["billingAmount"], message: "Enter an amount greater than 0, e.g. 650 or 650.50" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.billingDate) || Number.isNaN(Date.parse(v.billingDate))) {
      ctx.addIssue({ code: "custom", path: ["billingDate"], message: "Choose a date" });
    }
    if (!PAYMENT_TERMS.includes(Number(v.billingTermsDays) as (typeof PAYMENT_TERMS)[number])) {
      ctx.addIssue({ code: "custom", path: ["billingTermsDays"], message: "Choose payment terms" });
    }
  })
  .transform((v) => ({
    type: v.billingType,
    description: v.billingDescription,
    amount: Number(v.billingAmount).toFixed(2),
    date: v.billingDate,
    termsDays: Number(v.billingTermsDays),
  }));

export const CLIENT_FIELDS = [
  "name",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "province",
  "postalCode",
  "country",
  "timezone",
  "preferredChannel",
  "billingType",
  "billingDescription",
  "billingAmount",
  "billingDate",
  "billingTermsDays",
] as const;

export type ClientFormValues = Record<(typeof CLIENT_FIELDS)[number], string> & { smsConsent: boolean };

export function readClientForm(formData: FormData): ClientFormValues {
  const values = Object.fromEntries(
    CLIENT_FIELDS.map((f) => [f, String(formData.get(f) ?? "")]),
  ) as Record<(typeof CLIENT_FIELDS)[number], string>;
  return { ...values, smsConsent: formData.get("smsConsent") === "on" };
}
