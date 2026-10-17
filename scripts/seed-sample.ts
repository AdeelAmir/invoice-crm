import { execSync } from "node:child_process";

// npm run db:seed:sample - the seed with sample clients and invoices
// (on an empty database; run npm run db:reset first).
execSync("npx prisma db seed", { stdio: "inherit", env: { ...process.env, SEED_SAMPLE_DATA: "true" } });
