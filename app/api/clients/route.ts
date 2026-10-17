import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/clients?search=<name or email>&includeInactive=true
// Lets the agent find the client an invoice is for.
const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.enum(["true", "false"]).default("false"),
});

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return badRequest("Invalid query", z.flattenError(parsed.error).fieldErrors);
  const { search, includeInactive } = parsed.data;

  const clients = await prisma.client.findMany({
    where: {
      ...(includeInactive === "true" ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
  });
  return NextResponse.json({
    count: clients.length,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      city: c.city,
      province: c.province,
      country: c.country,
      timezone: c.timezone,
      preferredChannel: c.preferredChannel,
      isActive: c.isActive,
    })),
  });
}
