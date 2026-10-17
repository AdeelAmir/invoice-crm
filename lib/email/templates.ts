// Designed emails. Every email has an HTML version (inline styles and
// tables, so Gmail and Outlook render it) and a plain-text version. The
// message text comes from the agent (or from code for admin emails); the
// amounts, items and payment button always come from the CRM.

export type EmailKind = "INVOICE" | "RECEIPT" | "REMINDER" | "REPLY" | "ESCALATION" | "ALERT";

export type EmailInvoiceView = {
  number: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  terms: string;
  currency: string;
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
  subtotal: string;
  taxes: { label: string; amount: string }[];
  total: string;
  status: string;
  paidOn: string | null;
};

export type EmailContent = {
  kind: EmailKind;
  brand: string;
  message: string;
  invoice?: EmailInvoiceView;
  cta?: { label: string; url: string };
  /** Small print under the button, e.g. where an admin link leads. */
  note?: string;
};

const THEMES: Record<EmailKind, { accent: string; soft: string; label: string }> = {
  INVOICE: { accent: "#4f46e5", soft: "#eef0fe", label: "Invoice" },
  REMINDER: { accent: "#d97706", soft: "#fef6e7", label: "Payment reminder" },
  RECEIPT: { accent: "#059669", soft: "#e8f8f1", label: "Payment received" },
  REPLY: { accent: "#4f46e5", soft: "#eef0fe", label: "Message" },
  ESCALATION: { accent: "#dc2626", soft: "#fdeeee", label: "Action needed" },
  ALERT: { accent: "#dc2626", soft: "#fdeeee", label: "Invoice failed" },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function hero(kind: EmailKind, inv: EmailInvoiceView, accent: string, soft: string): string {
  const label =
    kind === "RECEIPT" ? "Amount paid" : kind === "REMINDER" ? "Overdue balance" : inv.status === "PAID" ? "Invoice total" : "Amount due";
  const sub =
    kind === "RECEIPT"
      ? `Paid ${inv.paidOn ?? ""} &middot; Invoice ${escapeHtml(inv.number)}`
      : `${kind === "REMINDER" ? "Was due" : "Due"} ${escapeHtml(inv.dueDate)} &middot; Invoice ${escapeHtml(inv.number)}`;
  return `
<tr><td style="padding:4px 40px 8px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${soft};border-radius:12px;">
    <tr><td style="padding:22px 24px;">
      <div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${accent};">${label}</div>
      <div style="margin-top:6px;font-size:32px;font-weight:700;letter-spacing:-.02em;color:#0f172a;">${escapeHtml(inv.total)} <span style="font-size:15px;font-weight:600;color:#64748b;">${escapeHtml(inv.currency)}</span></div>
      <div style="margin-top:4px;font-size:13px;color:#475569;">${sub}</div>
    </td></tr>
  </table>
</td></tr>`;
}

function button(cta: { label: string; url: string }, accent: string): string {
  const url = escapeHtml(cta.url);
  return `
<tr><td align="center" style="padding:8px 40px 6px;">
  <table role="presentation" cellspacing="0" cellpadding="0"><tr>
    <td align="center" bgcolor="${accent}" style="border-radius:10px;background:${accent};box-shadow:0 6px 16px rgba(15,23,42,.18);">
      <a href="${url}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(cta.label)} &rarr;</a>
    </td>
  </tr></table>
  <div style="margin-top:10px;font-size:12px;color:#94a3b8;">Or open this link: <a href="${url}" style="color:#64748b;">${url}</a></div>
</td></tr>`;
}

function details(inv: EmailInvoiceView): string {
  const row = (left: string, right: string, opts: { bold?: boolean; muted?: boolean; top?: boolean } = {}) => `
    <tr>
      <td style="padding:${opts.top ? "12px" : "6px"} 0 6px;font-size:14px;color:${opts.muted ? "#64748b" : "#0f172a"};${opts.bold ? "font-weight:700;" : ""}${opts.top ? "border-top:1px solid #e5e7ef;" : ""}">${left}</td>
      <td align="right" style="padding:${opts.top ? "12px" : "6px"} 0 6px;font-size:14px;color:#0f172a;white-space:nowrap;${opts.bold ? "font-weight:700;" : ""}${opts.top ? "border-top:1px solid #e5e7ef;" : ""}">${right}</td>
    </tr>`;
  const items = inv.lines
    .map(
      (l) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f2f7;font-size:14px;color:#0f172a;">${escapeHtml(l.description)}<div style="font-size:12px;color:#94a3b8;margin-top:2px;">${escapeHtml(l.quantity)} &times; ${escapeHtml(l.unitPrice)}</div></td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #f1f2f7;font-size:14px;color:#0f172a;white-space:nowrap;">${escapeHtml(l.amount)}</td>
    </tr>`,
    )
    .join("");
  return `
<tr><td style="padding:24px 40px 8px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7ef;border-radius:12px;">
    <tr><td style="padding:18px 22px 6px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="font-size:13px;color:#64748b;">Billed to<div style="margin-top:2px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(inv.clientName)}</div></td>
          <td align="right" style="font-size:13px;color:#64748b;">Invoice<div style="margin-top:2px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(inv.number)}</div></td>
        </tr>
        <tr>
          <td style="padding-top:10px;font-size:13px;color:#64748b;">Issued ${escapeHtml(inv.issueDate)}</td>
          <td align="right" style="padding-top:10px;font-size:13px;color:#64748b;">Due ${escapeHtml(inv.dueDate)} (${escapeHtml(inv.terms)})</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:6px 22px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${items}
        ${row("Subtotal", escapeHtml(inv.subtotal), { muted: true })}
        ${inv.taxes.map((t) => row(escapeHtml(t.label), escapeHtml(t.amount), { muted: true })).join("")}
        ${row(`Total (${escapeHtml(inv.currency)})`, escapeHtml(inv.total), { bold: true, top: true })}
      </table>
    </td></tr>
  </table>
</td></tr>`;
}

export function renderHtml(c: EmailContent): string {
  const t = THEMES[c.kind];
  const toClient = c.kind !== "ESCALATION" && c.kind !== "ALERT";
  const showHero = c.invoice && (c.kind === "INVOICE" || c.kind === "REMINDER" || c.kind === "RECEIPT");
  const showDetails = c.invoice && (c.kind === "INVOICE" || c.kind === "REMINDER" || c.kind === "RECEIPT");
  const initial = escapeHtml(c.brand.trim().charAt(0).toUpperCase() || "L");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(t.label)}</title></head>
<body style="margin:0;padding:0;background:#f4f5fb;font-family:${FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5fb;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7e8f2;border-radius:16px;overflow:hidden;">
    <tr><td style="height:5px;background:${t.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:26px 40px 18px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td valign="middle">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td valign="middle" style="width:36px;height:36px;border-radius:10px;background:#4f46e5;color:#ffffff;font-size:18px;font-weight:700;text-align:center;">${initial}</td>
            <td valign="middle" style="padding-left:10px;font-size:17px;font-weight:700;color:#0f172a;">${escapeHtml(c.brand)}</td>
          </tr></table>
        </td>
        <td align="right" valign="middle"><span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${t.soft};color:${t.accent};font-size:12px;font-weight:600;">${escapeHtml(t.label)}</span></td>
      </tr></table>
    </td></tr>
    ${showHero ? hero(c.kind, c.invoice!, t.accent, t.soft) : ""}
    <tr><td style="padding:22px 40px 6px;">${paragraphs(c.message)}</td></tr>
    ${c.cta ? button(c.cta, t.accent) : ""}
    ${c.note ? `<tr><td style="padding:4px 40px 0;font-size:12px;color:#94a3b8;text-align:center;">${escapeHtml(c.note)}</td></tr>` : ""}
    ${showDetails ? details(c.invoice!) : ""}
    <tr><td style="padding:26px 40px 30px;">
      <div style="border-top:1px solid #eef0f5;padding-top:18px;font-size:12px;line-height:1.6;color:#94a3b8;">
        ${toClient ? "Questions about this invoice? Just reply to this email and we'll help.<br>" : ""}
        ${escapeHtml(c.brand)} &middot; Billing
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

export function renderText(c: EmailContent): string {
  const parts = [c.message.trim()];
  const inv = c.invoice;
  if (inv && (c.kind === "INVOICE" || c.kind === "REMINDER" || c.kind === "RECEIPT")) {
    const heading =
      c.kind === "RECEIPT"
        ? [`PAYMENT RECEIPT - INVOICE ${inv.number}`, `Amount paid: ${inv.total} ${inv.currency}`, `Paid on: ${inv.paidOn ?? "-"}`]
        : [
            `${c.kind === "REMINDER" ? "OVERDUE INVOICE" : "INVOICE"} ${inv.number}`,
            `${c.kind === "REMINDER" ? "Overdue balance" : "Amount due"}: ${inv.total} ${inv.currency}`,
            `Due date: ${inv.dueDate} (${inv.terms})`,
          ];
    parts.push(
      [
        ...heading,
        "",
        "Items",
        ...inv.lines.map((l) => `  ${l.description} - ${l.quantity} x ${l.unitPrice} = ${l.amount}`),
        "",
        `Subtotal: ${inv.subtotal}`,
        ...inv.taxes.map((t) => `${t.label}: ${t.amount}`),
        `Total: ${inv.total} ${inv.currency}`,
      ].join("\n"),
    );
  }
  if (c.cta) parts.push(`${c.cta.label}: ${c.cta.url}`);
  if (c.note) parts.push(c.note);
  parts.push(
    c.kind === "ESCALATION" || c.kind === "ALERT"
      ? `${c.brand} - Billing`
      : `Questions about this invoice? Just reply to this email.\n${c.brand} - Billing`,
  );
  return parts.join("\n\n");
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  return { html: renderHtml(c), text: renderText(c) };
}
