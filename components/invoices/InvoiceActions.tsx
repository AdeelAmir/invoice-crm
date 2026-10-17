"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Loader2, Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  generateNowAction,
  retryInvoiceAction,
  setStatusAction,
  type ActionResult,
} from "@/app/dashboard/invoices/actions";

type ManualStatus = "PAID" | "CANCELLED";

const MANUAL: Record<ManualStatus, { label: string; confirm: string; icon: typeof Ban }> = {
  PAID: {
    label: "Mark as paid",
    confirm: "Record this invoice as paid? Use this when the payment was received outside the gateway.",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Cancel invoice",
    confirm: "Cancel this invoice? A cancelled invoice is never processed or retried again.",
    icon: Ban,
  },
};

export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  canRetry,
  canGenerate,
  manualStatuses = [],
  compact = false,
}: {
  invoiceId: number;
  invoiceNumber: string;
  canRetry: boolean;
  canGenerate: boolean;
  manualStatuses?: ManualStatus[];
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ManualStatus | null>(null);

  const run = (key: string, action: () => Promise<ActionResult>) => {
    setRunning(key);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) toast.success(`${invoiceNumber}: ${result.message}`);
        else toast.error(`${invoiceNumber}: ${result.message}`);
      } catch {
        toast.error(`${invoiceNumber}: the request failed. Check that you are still signed in.`);
      } finally {
        setRunning(null);
      }
    });
  };

  const size = compact ? "sm" : "default";
  const spinner = <Loader2 className="animate-spin" />;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRetry && (
        <Button
          size={size}
          disabled={pending}
          onClick={() => run("retry", () => retryInvoiceAction(invoiceId))}
        >
          {running === "retry" ? spinner : <RotateCw />}
          {running === "retry" ? "Retrying…" : "Retry"}
        </Button>
      )}
      {canGenerate && (
        <Button
          size={size}
          variant={compact ? "outline" : "default"}
          disabled={pending}
          onClick={() => run("generate", () => generateNowAction(invoiceId))}
        >
          {running === "generate" ? spinner : <Play />}
          {running === "generate" ? "Processing…" : "Generate now"}
        </Button>
      )}
      {manualStatuses.map((status) => {
        const { label, icon: Icon } = MANUAL[status];
        return (
          <Button
            key={status}
            size={size}
            variant="outline"
            disabled={pending}
            onClick={() => setConfirming(status)}
          >
            {running === status ? spinner : <Icon />}
            {label}
          </Button>
        );
      })}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming && MANUAL[confirming].label} · {invoiceNumber}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirming && MANUAL[confirming].confirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep as is</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const status = confirming!;
                setConfirming(null);
                run(status, () => setStatusAction(invoiceId, status));
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
