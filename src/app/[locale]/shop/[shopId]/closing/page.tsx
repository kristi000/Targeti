"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

import { DailyClosingClient } from "@/components/daily-closing-client";
import { useShop } from "@/components/shop-provider";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function DailyClosingPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { shops, selectedShop, setSelectedShop } = useShop();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(item => item.id === shopId);

  useEffect(() => {
    const shop = shops.find(item => item.id === shopId);
    if (shop && selectedShop?.id !== shop.id) setSelectedShop(shop);
  }, [shops, shopId, selectedShop?.id, setSelectedShop]);

  if (selectedShop?.id === shopId) return <DailyClosingClient />;
  return <div className="shop-page-content flex min-h-64 items-center justify-center">{routeShop
    ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
    : <p>{t("shopNotFound")}</p>}
  </div>;
}
