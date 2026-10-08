import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ShopPageToolbarProps = {
  periodSelector?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
};

export function ShopPageToolbar({ periodSelector, children, className, id }: ShopPageToolbarProps) {
  return (
    <div id={id} className={cn("shop-page-toolbar flex w-full flex-wrap items-center justify-between gap-2", className)}>
      {periodSelector && <div className="h-9 w-44 shrink-0 sm:w-56">{periodSelector}</div>}
      {children && <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">{children}</div>}
    </div>
  );
}
