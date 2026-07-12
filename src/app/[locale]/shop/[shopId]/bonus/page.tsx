"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { BonusDashboardClient } from "@/components/bonus-dashboard-client";
import { useShop } from "@/components/shop-provider";

export default function BonusPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { shops, selectedShop, setSelectedShop } = useShop();
  useEffect(() => { const shop = shops.find(item => item.id === shopId); if (shop && selectedShop?.id !== shop.id) setSelectedShop(shop); }, [shops, shopId, selectedShop, setSelectedShop]);
  return selectedShop?.id === shopId ? <BonusDashboardClient /> : null;
}
