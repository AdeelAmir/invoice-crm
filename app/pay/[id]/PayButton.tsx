"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { payInvoiceAction } from "./actions";

export function PayButton({ invoiceId, label }: { invoiceId: number; label: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      className="w-full"
      size="lg"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const r = await payInvoiceAction(invoiceId);
            if (r.ok) toast.success(r.message);
            else toast.error(r.message);
            router.refresh();
          } catch {
            toast.error("The payment request failed. Try again.");
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
      {pending ? "Processing…" : label}
    </Button>
  );
}
