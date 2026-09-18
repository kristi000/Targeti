"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";

import { DetailedDashboardClient } from "@/components/detailed-dashboard-client";
import { useShop } from "@/components/shop-provider";
import { buttonVariants } from "@/components/ui/button";
import { useShopPerformance } from "@/hooks/use-shop-performance";
import { cn } from "@/lib/utils";

export function DetailedDashboardRoute({ shopId }: { shopId: string }) {
  const { shops, selectedShop, setSelectedShop } = useShop();
  const locale = useLocale();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(shop => shop.id === shopId);
  const performanceQuery = useShopPerformance(shopId, Boolean(routeShop));

  useEffect(() => {
    if (routeShop && selectedShop?.id !== routeShop.id) setSelectedShop(routeShop);
  }, [routeShop, selectedShop?.id, setSelectedShop]);

  if (selectedShop?.id === shopId && performanceQuery.data) return <DetailedDashboardClient allData={performanceQuery.data} />;

  return (
    <div className="flex h-full flex-col p-4 md:p-6 lg:p-8">
      <Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4 w-fit")}>
        <ArrowLeft className="mr-2" /> {t("backToOverview")}
      </Link>
      <div className="flex flex-1 items-center justify-center">
        {routeShop
          ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
          : <p>{t("shopNotFound")}</p>}
      </div>
    </div>
  );
}
