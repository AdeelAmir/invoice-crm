import { execSync } from "node:child_process";
import { Client } from "pg";

// Rebuild the test database from the migrations before the integration run.
export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
  if (!/_test(\?|$)/.test(new URL(url).pathname + "?")) {
    throw new Error("DATABASE_URL_TEST must point at a database whose name ends in _test");
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await db.end();

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
