"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { BonusDashboardClient } from "@/components/bonus-dashboard-client";
import { useShop } from "@/components/shop-provider";

export function BonusDashboardRoute({ shopId, requestedMonth }: { shopId: string; requestedMonth?: string }) {
  const { shops, selectedShop, setSelectedShop } = useShop();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(shop => shop.id === shopId);

  useEffect(() => {
    if (routeShop && selectedShop?.id !== routeShop.id) setSelectedShop(routeShop);
  }, [routeShop, selectedShop?.id, setSelectedShop]);

  if (selectedShop?.id === shopId) return <BonusDashboardClient key={`${shopId}:${requestedMonth ?? ""}`} requestedMonth={requestedMonth} />;
  return (
    <div className="flex min-h-64 items-center justify-center p-6">
      {routeShop
        ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
        : <p>{t("shopNotFound")}</p>}
    </div>
  );
}
