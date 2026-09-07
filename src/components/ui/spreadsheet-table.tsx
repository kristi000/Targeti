import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Compact report grid; scoped so other application tables keep their styling. */
export function SpreadsheetTable({ className, ...props }: ComponentProps<"table">) {
  return <div className="max-h-[65vh] overflow-auto border border-slate-300 dark:border-slate-600">
    <table
      className={cn(
        "w-full border-separate border-spacing-0 text-xs tabular-nums",
        "[&_th]:h-8 [&_th]:border-b [&_th]:border-r [&_th]:border-slate-300 [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold",
        "[&_td]:h-8 [&_td]:border-b [&_td]:border-r [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5",
        "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-emerald-800 [&_thead_th]:text-white",
        "[&_tbody_tr:nth-child(even)]:bg-slate-50 [&_tbody_tr:hover]:bg-emerald-50",
        "[&_tfoot_td]:sticky [&_tfoot_td]:bottom-0 [&_tfoot_td]:z-10 [&_tfoot_td]:border-t-2 [&_tfoot_td]:border-t-emerald-700 [&_tfoot_td]:bg-emerald-100 [&_tfoot_td]:font-bold [&_tfoot_td]:text-emerald-950",
        "[&_tr>*:last-child]:border-r-0",
        "dark:[&_th]:border-slate-600 dark:[&_td]:border-slate-700 dark:[&_tbody_tr:nth-child(even)]:bg-slate-900 dark:[&_tbody_tr:hover]:bg-emerald-950 dark:[&_tfoot_td]:bg-emerald-950 dark:[&_tfoot_td]:text-emerald-100",
        className,
      )}
      {...props}
    />
  </div>;
}
