"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveEscalationAction } from "@/app/dashboard/invoices/actions";

export function ResolveEscalation({ invoiceId }: { invoiceId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const r = await resolveEscalationAction(invoiceId);
            if (r.ok) toast.success(r.message);
            else toast.error(r.message);
          } catch {
            toast.error("The request failed. Check that you are still signed in.");
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
      Mark resolved
    </Button>
  );
}
