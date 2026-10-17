import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { emailConfig } from "@/lib/config";
import type { EmailMessage } from "@/lib/generated/prisma/client";
import type { EmailKind } from "@/lib/generated/prisma/enums";

// Every email is first written to email_messages (the outbox). With
// EMAIL_PROVIDER=resend it is then handed to Resend and the row records the
// outcome. A delivery failure never throws: callers read `delivery`.

export type OutgoingEmail = {
  invoiceId: number;
  kind: EmailKind;
  to: string;
  subject: string;
  body: string; // plain text
  html?: string; // designed version
};

/** Plain address out of "Name <a@b.c>". */
export function addressOf(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from;
}

/** Actual recipient: EMAIL_TEST_RECIPIENT, when set, receives every email. */
export function deliveryAddress(to: string): string {
  return emailConfig().testRecipient ?? to;
}

// Hands one email to Resend (to the test inbox when EMAIL_TEST_RECIPIENT
// is set; the outbox row keeps the intended recipient).
async function deliver(email: { to: string; subject: string; body: string; html?: string }) {
  const cfg = emailConfig();
  if (!cfg.resendApiKey) throw new Error("RESEND_API_KEY is not set");
  const deliveredTo = deliveryAddress(email.to);
  const { data, error } = await new Resend(cfg.resendApiKey).emails.send({
    from: cfg.from,
    to: deliveredTo,
    subject: email.subject,
    text: email.body,
    ...(email.html ? { html: email.html } : {}),
  });
  if (error) throw new Error(error.message);
  return { providerId: data?.id ?? null, deliveredTo };
}

export async function sendEmail(email: OutgoingEmail): Promise<EmailMessage> {
  const cfg = emailConfig();
  const row = await prisma.emailMessage.create({
    data: {
      invoiceId: email.invoiceId,
      direction: "OUTBOUND",
      kind: email.kind,
      toAddress: email.to,
      fromAddress: cfg.from,
      subject: email.subject,
      body: email.body,
      html: email.html ?? null,
      delivery: "OUTBOX",
      deliveredTo: cfg.provider === "resend" ? deliveryAddress(email.to) : null,
    },
  });
  if (cfg.provider !== "resend") return row;

  try {
    const { providerId } = await deliver(email);
    return prisma.emailMessage.update({ where: { id: row.id }, data: { delivery: "SENT", providerId } });
  } catch (err) {
    return prisma.emailMessage.update({
      where: { id: row.id },
      data: { delivery: "FAILED", error: err instanceof Error ? err.message : "Unknown email error" },
    });
  }
}

export type DirectEmailResult =
  | { ok: true; sent: boolean; deliveredTo: string }
  | { ok: false; error: string };

/** An email not tied to an invoice (the Settings test email). Not stored in the outbox. */
export async function sendDirectEmail(email: { to: string; subject: string; body: string; html?: string }): Promise<DirectEmailResult> {
  if (emailConfig().provider !== "resend") return { ok: true, sent: false, deliveredTo: email.to };
  try {
    const { deliveredTo } = await deliver(email);
    return { ok: true, sent: true, deliveredTo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown email error" };
  }
}
