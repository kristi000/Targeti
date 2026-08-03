"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { BonusDashboardClient } from "@/components/bonus-dashboard-client";
import { useShop } from "@/components/shop-provider";

export default function BonusPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { shops, selectedShop, setSelectedShop, loadPerformanceForShop } = useShop();
  useEffect(() => {
    const shop = shops.find(item => item.id === shopId);
    if (shop && selectedShop?.id !== shop.id) setSelectedShop(shop);
    if (shop) void loadPerformanceForShop(shop.id);
  }, [shops, shopId, selectedShop, setSelectedShop, loadPerformanceForShop]);

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

  return selectedShop?.id === shopId ? <BonusDashboardClient /> : null;
}
