// Product name shown in the app and in every email. BUSINESS_NAME in .env
// overrides it (it is the sender name clients see).
export function brandName(): string {
  return process.env.BUSINESS_NAME || "Ledgerly";
}

export const BRAND_TAGLINE = "Invoicing on autopilot";
