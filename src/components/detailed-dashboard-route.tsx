"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";

import { DetailedDashboardClient } from "@/components/detailed-dashboard-client";
import { useShop } from "@/components/shop-provider";
import { useDashboardNavigation } from "@/components/dashboard-navigation-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DetailedDashboardRoute({ shopId, requestedMonth }: { shopId: string; requestedMonth?: string }) {
  const { shops, selectedShop, setSelectedShop } = useShop();
  const { dashboardHref } = useDashboardNavigation();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(shop => shop.id === shopId);

  useEffect(() => {
    if (routeShop && selectedShop?.id !== routeShop.id) setSelectedShop(routeShop);
  }, [routeShop, selectedShop?.id, setSelectedShop]);

  if (selectedShop?.id === shopId) return <DetailedDashboardClient key={`${shopId}:${requestedMonth ?? ""}`} requestedMonth={requestedMonth} />;

  return (
    <div className="shop-page-content flex h-full flex-col">
      <Link href={dashboardHref} className={cn(buttonVariants({ variant: "outline" }), "mb-4 w-fit")}>
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
