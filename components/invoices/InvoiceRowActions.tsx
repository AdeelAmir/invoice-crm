"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Eye, Loader2, Mail, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/invoices/StatusBadge";
import {
  deleteInvoiceAction,
  getInvoicePreviewAction,
  type InvoicePreview,
} from "@/app/dashboard/invoices/actions";
import type { InvoiceStatus } from "@/lib/generated/prisma/enums";

// View and Delete for one invoice row, each in a modal.
export function InvoiceRowActions({ invoiceId, invoiceNumber }: { invoiceId: number; invoiceNumber: string }) {
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [loading, startLoading] = useTransition();
  const [deleting, startDeleting] = useTransition();

  const openView = () => {
    setViewOpen(true);
    startLoading(async () => {
      try {
        const p = await getInvoicePreviewAction(invoiceId);
        if (!p) {
          toast.error(`${invoiceNumber} no longer exists`);
          setViewOpen(false);
        } else setPreview(p);
      } catch {
        toast.error("Could not load the invoice. Check that you are still signed in.");
        setViewOpen(false);
      }
    });
  };

  const confirmDelete = () =>
    startDeleting(async () => {
      try {
        const r = await deleteInvoiceAction(invoiceId);
        if (r.ok) {
          toast.success(r.message);
          setDeleteOpen(false);
        } else toast.error(r.message);
      } catch {
        toast.error("Could not delete the invoice. Check that you are still signed in.");
      }
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={openView} title={`View ${invoiceNumber}`}>
        <Eye /> View
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={() => setDeleteOpen(true)}
        title={`Delete ${invoiceNumber}`}
      >
        <Trash2 /> Delete
      </Button>

      {/* View */}
      <AlertDialog open={viewOpen} onOpenChange={setViewOpen}>
        <AlertDialogContent className="max-h-[90vh] max-w-2xl gap-0 overflow-hidden rounded-2xl p-0">
          <div className="flex items-start justify-between gap-4 bg-sidebar px-6 py-5 text-white">
            <div>
              <AlertDialogTitle className="text-white">{preview?.number ?? invoiceNumber}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-sm text-white/70">
                {preview ? `${preview.type} invoice for ${preview.client.name}` : "Loading invoice…"}
              </AlertDialogDescription>
            </div>
            <button
              type="button"
              onClick={() => setViewOpen(false)}
              className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>

          {loading || !preview ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="max-h-[calc(90vh-9rem)] overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={preview.status as InvoiceStatus} />
                {preview.needsAttention && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">Needs attention</span>
                )}
                <span className="ml-auto text-2xl font-semibold tracking-tight tabular-nums">
                  {preview.total} <span className="text-sm font-medium text-muted-foreground">{preview.currency}</span>
                </span>
              </div>

              {preview.lastError && (
                <p className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {preview.lastError}
                </p>
              )}

              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <Info label="Client" value={preview.client.name} sub={preview.client.email} />
                <Info label="Issued" value={preview.issueDate} />
                <Info label="Due" value={preview.dueDate} sub={preview.terms} />
                <Info label="Paid" value={preview.paidOn ?? "—"} />
              </dl>

              <div className="mt-5 overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Price</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-4 py-2.5">{l.description}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{l.unitPrice}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{l.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="space-y-1 border-t bg-muted/30 px-4 py-3 text-sm">
                  <Total label="Subtotal" value={preview.subtotal} />
                  {preview.taxes.map((t) => (
                    <Total key={t.label} label={t.label} value={t.amount} />
                  ))}
                  <Total label={`Total (${preview.currency})`} value={preview.total} strong />
                </dl>
              </div>

              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="size-4" />
                {preview.emails === 0
                  ? "No emails sent yet."
                  : `${preview.emails} email${preview.emails === 1 ? "" : "s"} sent · last: ${preview.lastEmail}`}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t bg-muted/30 px-6 py-4">
            <AlertDialogCancel className="mt-0">Close</AlertDialogCancel>
            <Button asChild>
              <Link href={`/dashboard/invoices/${invoiceId}`}>
                Open full page <ArrowUpRight />
              </Link>
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <AlertDialogContent className="max-w-md rounded-2xl">
          <div className="flex gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Trash2 className="size-5" />
            </span>
            <div>
              <AlertDialogTitle>Delete {invoiceNumber}?</AlertDialogTitle>
              <AlertDialogDescription className="mt-2 leading-relaxed">
                The invoice, its items, emails and history are removed for good. This cannot be undone. If it is the upcoming
                invoice of a monthly plan, that schedule stops; edit the client to start billing again.
              </AlertDialogDescription>
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <AlertDialogCancel className="mt-0" disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete invoice
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium wrap-anywhere">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground wrap-anywhere">{sub}</dd>}
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t pt-2 font-semibold" : "text-muted-foreground"}`}>
      <dt>{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-foreground" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}
