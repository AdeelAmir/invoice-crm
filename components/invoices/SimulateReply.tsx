"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { simulateClientReplyAction } from "@/app/dashboard/invoices/actions";

// Testing aid: stands in for an email from the client. The agent answers it.
export function SimulateReply({ invoiceId, clientName }: { invoiceId: number; clientName: string }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      try {
        const r = await simulateClientReplyAction(invoiceId, text);
        if (r.ok) {
          toast.success(r.message);
          setText("");
        } else toast.error(r.message);
      } catch {
        toast.error("The request failed. Check that you are still signed in.");
      }
    });

  return (
    <div className="space-y-2 border-t px-4 py-3">
      <label htmlFor="simulate-reply" className="text-xs font-medium text-muted-foreground">
        Test a client reply: write as {clientName} and the assistant will answer it
      </label>
      <textarea
        id="simulate-reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="e.g. Hi, can you explain the QST line on this invoice?"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" disabled={pending || text.trim().length < 2} onClick={submit}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Send as client
        </Button>
      </div>
    </div>
  );
}
