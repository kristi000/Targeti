"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

import { DailyClosingClient } from "@/components/daily-closing-client";
import { useShop } from "@/components/shop-provider";

export default function DailyClosingPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { shops, selectedShop, setSelectedShop } = useShop();

  useEffect(() => {
    const shop = shops.find(item => item.id === shopId);
    if (shop && selectedShop?.id !== shop.id) setSelectedShop(shop);
  }, [shops, shopId, selectedShop?.id, setSelectedShop]);

  return selectedShop?.id === shopId ? <DailyClosingClient /> : null;
}
