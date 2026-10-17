import bcrypt from "bcryptjs";

const COST = 12;

// Compared against when the email is unknown, so a wrong email and a wrong
// password take the same time. Computed once, on first use.
let dummyHash: Promise<string> | null = null;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash === null) {
    dummyHash ??= bcrypt.hash("not-a-real-password", COST);
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
