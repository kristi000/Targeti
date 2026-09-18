import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Compact report grid; scoped so other application tables keep their styling. */
export function SpreadsheetTable({ className, compact = true, ...props }: ComponentProps<"table"> & { compact?: boolean }) {
  return <div className="max-h-[65vh] w-fit max-w-full overflow-auto rounded-md border border-border bg-background">
    <table
      className={cn(
        "w-max border-separate border-spacing-0 text-xs tabular-nums",
        compact
          ? "[&_th]:h-7 [&_th]:border-b [&_th]:border-r [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_td]:h-7 [&_td]:border-b [&_td]:border-r [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1"
          : "[&_th]:h-8 [&_th]:border-b [&_th]:border-r [&_th]:border-slate-300 [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold [&_td]:h-8 [&_td]:border-b [&_td]:border-r [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5",
        "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted [&_thead_th]:text-foreground",
        "[&_tbody_tr:nth-child(even)]:bg-muted/30 [&_tbody_tr:hover]:bg-accent/50",
        "[&_tfoot_td]:sticky [&_tfoot_td]:bottom-0 [&_tfoot_td]:z-10 [&_tfoot_td]:border-t [&_tfoot_td]:border-border [&_tfoot_td]:bg-muted [&_tfoot_td]:font-semibold",
        "[&_tr>*:last-child]:border-r-0",
        "dark:[&_th]:border-border dark:[&_td]:border-border",
        className,
      )}
      {...props}
    />
  </div>;
}
