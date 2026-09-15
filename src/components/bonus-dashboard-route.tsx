"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { BonusDashboardClient } from "@/components/bonus-dashboard-client";
import { useShop } from "@/components/shop-provider";

export function BonusDashboardRoute({ shopId }: { shopId: string }) {
  const { shops, selectedShop, setSelectedShop, loadPerformanceForShop } = useShop();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(shop => shop.id === shopId);

  useEffect(() => {
    if (routeShop && selectedShop?.id !== routeShop.id) setSelectedShop(routeShop);
    if (routeShop) void loadPerformanceForShop(routeShop.id);
  }, [routeShop, selectedShop?.id, setSelectedShop, loadPerformanceForShop]);

  useEffect(() => {
    const refreshPerformance = () => void loadPerformanceForShop(shopId);
    const refreshVisiblePerformance = () => {
      if (document.visibilityState === "visible") refreshPerformance();
    };
    window.addEventListener("focus", refreshPerformance);
    document.addEventListener("visibilitychange", refreshVisiblePerformance);
    return () => {
      window.removeEventListener("focus", refreshPerformance);
      document.removeEventListener("visibilitychange", refreshVisiblePerformance);
    };
  }, [shopId, loadPerformanceForShop]);

  if (selectedShop?.id === shopId) return <BonusDashboardClient />;
  return (
    <div className="flex min-h-64 items-center justify-center p-6">
      {routeShop
        ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
        : <p>{t("shopNotFound")}</p>}
    </div>
  );
}
