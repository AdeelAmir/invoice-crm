import { describe, expect, it } from "vitest";
import {
  ADMIN_TRANSITIONS,
  SYSTEM_TRANSITIONS,
  canTransition,
  retryDelaySeconds,
} from "@/lib/invoices/transitions";
import { clientSchema } from "@/lib/validation/client";
import { requireApiKey } from "@/lib/api-key";
import { signSession, verifySession } from "@/lib/auth/token";
import { clearAttempts, isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit";

describe("status transitions", () => {
  it("never lets anything but the claim move PENDING to PROCESSING", () => {
    expect(canTransition(SYSTEM_TRANSITIONS, "PENDING", "PROCESSING")).toBe(false);
    expect(canTransition(ADMIN_TRANSITIONS, "PENDING", "PROCESSING")).toBe(false);
  });

  it("limits admins to cancel and mark-paid", () => {
    expect(canTransition(ADMIN_TRANSITIONS, "CREATED", "PAID")).toBe(true);
    expect(canTransition(ADMIN_TRANSITIONS, "FAILED", "CANCELLED")).toBe(true);
    expect(canTransition(ADMIN_TRANSITIONS, "FAILED", "PAID")).toBe(false);
    expect(canTransition(ADMIN_TRANSITIONS, "PROCESSING", "CANCELLED")).toBe(false);
    expect(canTransition(ADMIN_TRANSITIONS, "PAID", "CANCELLED")).toBe(false);
  });

  it("treats PAID and CANCELLED as final", () => {
    expect(SYSTEM_TRANSITIONS.PAID).toEqual([]);
    expect(SYSTEM_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("backs off exponentially", () => {
    expect([1, 2, 3, 4].map((n) => retryDelaySeconds(n, 60))).toEqual([60, 120, 240, 480]);
  });
});

describe("clientSchema", () => {
  const valid = {
    name: "Boulangerie",
    email: "Billing@Example.CA",
    phone: "+15145550142",
    addressLine1: "4521 boul. Saint-Laurent",
    addressLine2: "",
    city: "Montréal",
    province: "qc",
    postalCode: "h2t1r2",
    country: "CA",
    timezone: "America/Toronto",
    preferredChannel: "EMAIL",
    smsConsent: false,
  };

  it("normalises a valid Canadian client", () => {
    const r = clientSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      email: "billing@example.ca",
      province: "QC",
      postalCode: "H2T 1R2",
      addressLine2: null,
    });
  });

  it("requires SMS consent for the SMS channel", () => {
    const r = clientSchema.safeParse({ ...valid, preferredChannel: "SMS", smsConsent: false });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("smsConsent");
  });

  it("requires SMS consent for email + SMS (both), and accepts it with consent", () => {
    expect(clientSchema.safeParse({ ...valid, preferredChannel: "BOTH", smsConsent: false }).success).toBe(false);
    expect(clientSchema.safeParse({ ...valid, preferredChannel: "BOTH", smsConsent: true }).success).toBe(true);
  });

  it("rejects a bad phone, email, timezone and postal code", () => {
    const r = clientSchema.safeParse({
      ...valid,
      phone: "514-555-0142",
      email: "factures@cafe",
      timezone: "Mars/Olympus",
      postalCode: "12345",
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["phone", "email", "timezone"]));
  });
});

describe("requireApiKey", () => {
  it("rejects a missing or wrong key and accepts the right one", () => {
    process.env.CRM_API_KEY = "a-sufficiently-long-key";
    const req = (headers: Record<string, string>) => new Request("http://x/api", { headers });
    expect(requireApiKey(req({}))?.status).toBe(401);
    expect(requireApiKey(req({ "x-api-key": "wrong-key-wrong-key" }))?.status).toBe(401);
    expect(requireApiKey(req({ "x-api-key": "a-sufficiently-long-key" }))).toBeNull();
    expect(requireApiKey(req({ authorization: "Bearer a-sufficiently-long-key" }))).toBeNull();
  });
});

describe("session token", () => {
  it("verifies its own tokens and rejects tampered ones", async () => {
    const token = await signSession({ sub: "1", email: "a@b.co" });
    expect(await verifySession(token)).toEqual({ sub: "1", email: "a@b.co" });
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
});

describe("login rate limit", () => {
  it("blocks after five failures and resets after the window", () => {
    const key = "x@y.z|1.2.3.4";
    clearAttempts(key);
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) recordFailedAttempt(key, t0);
    expect(isRateLimited(key, t0 + 1000)).toBe(true);
    expect(isRateLimited(key, t0 + 16 * 60 * 1000)).toBe(false);
  });
});
