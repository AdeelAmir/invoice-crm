import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// The CRM API is called by the automation, not by a browser: it takes an
// API key in `x-api-key` (or `Authorization: Bearer <key>`).
// Returns an error response, or null when the key is valid.
export function requireApiKey(request: Request): NextResponse | null {
  const expected = process.env.CRM_API_KEY;
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: "CRM_API_KEY is not configured" }, { status: 500 });
  }
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = request.headers.get("x-api-key") ?? bearer ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  return null;
}
