"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Native date input with the calendar icon on the right, where a click
// anywhere in the field opens the date picker: the browser's own indicator
// is stretched invisibly over the whole field, and showPicker() covers
// browsers that do not use it.
const DateInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  ({ className, onClick, ...props }, ref) => (
    <div className="relative">
      <Input
        ref={ref}
        type="date"
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // showPicker throws when the input is not user-activated; the native picker still works.
          }
          onClick?.(e);
        }}
        className={cn(
          "relative block cursor-pointer pr-10",
          "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          className,
        )}
        {...props}
      />
      <CalendarDays className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
);
DateInput.displayName = "DateInput";

export { DateInput };
