"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Power } from "lucide-react";
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
import { setClientActiveAction } from "@/app/dashboard/clients/actions";

export function ClientActiveToggle({ clientId, name, isActive }: { clientId: number; name: string; isActive: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    setOpen(false);
    startTransition(async () => {
      const result = await setClientActiveAction(clientId, !isActive);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  };

  return (
    <>
      <Button variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        <Power /> {isActive ? "Deactivate" : "Reactivate"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? "Deactivate" : "Reactivate"} {name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? "The client and their invoice history are kept, but their invoices will fail processing with a permanent error until the client is reactivated."
                : "Their invoices can be processed again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={apply}>{isActive ? "Deactivate" : "Reactivate"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
