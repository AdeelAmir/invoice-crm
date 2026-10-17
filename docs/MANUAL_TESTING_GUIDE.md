# Manual Testing Guide

Poori testing guide (Roman Urdu, A se Z, testing data ke saath) ab PDF mein hai:

- **PDF:** `docs/Ledgerly-Testing-Guide.pdf`
- **Source (edit karne ke liye):** `docs/testing-guide/guide.html`. Badalne ke baad PDF dobara banayein (browser mein kholein → Print → Save as PDF).

Short version:

1. Purana `npm run dev` band karke dobara chalayein (Terminal 1).
2. Terminal 2: `npm run agent:worker`
3. Login: http://localhost:3010/login, `admin@ledgerly.app` / `Ledgerly@2026`
4. Client Management → Add client → **Billing** section mein One-time ya Recurring (monthly), service, amount aur date → Create client.
5. Aaj ki date: invoice foran banti hai aur agent 10–40 second mein email bhejta hai. Aage ki date: us din subah 9 baje (client ke timezone mein) khud banti hai. Monthly: har mahine usi date par.
