"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { ShopPageToolbar } from "@/components/shop-page-toolbar";

type BonusPageLayoutProps = {
  title: string;
  navigation: ReactNode;
  periodSelector?: ReactNode;
  children: ReactNode;
};

export function BonusPageLayout({ title, navigation, periodSelector, children }: BonusPageLayoutProps) {
  return (
    <div className="flex h-full flex-col">
      <Header title={title} />
      <div className="shop-page-content flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <ShopPageToolbar periodSelector={periodSelector}>
            <div className="max-w-full overflow-x-auto">{navigation}</div>
          </ShopPageToolbar>
          {children}
        </div>
      </div>
    </div>
  );
}
