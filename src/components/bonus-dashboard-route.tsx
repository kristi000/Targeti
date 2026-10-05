"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { BonusDashboardClient } from "@/components/bonus-dashboard-client";
import { QuarterlyBonusClient } from "@/components/quarterly-bonus-client";
import { BonusHistoryClient } from "@/components/bonus-history-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShop } from "@/components/shop-provider";

export function BonusDashboardRoute({ shopId, requestedMonth, requestedQuarter, initialView = "monthly", historyDetail }: { shopId: string; requestedMonth?: string; requestedQuarter?: string; initialView?: "monthly" | "quarterly" | "history"; historyDetail?: { kind: "monthly" | "quarterly"; period: string } }) {
  const { shops, selectedShop, setSelectedShop } = useShop();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(shop => shop.id === shopId);

  useEffect(() => {
    if (routeShop && selectedShop?.id !== routeShop.id) setSelectedShop(routeShop);
  }, [routeShop, selectedShop?.id, setSelectedShop]);

  if (selectedShop?.id === shopId) return <Tabs key={initialView} defaultValue={initialView} onValueChange={view => {
    const url = new URL(window.location.href);
    if (view === "quarterly" || view === "history") url.searchParams.set("view", view);
    else url.searchParams.delete("view");
    if (view !== "history") { url.searchParams.delete("period"); url.searchParams.delete("kind"); }
    window.history.replaceState(null, "", url);
  }} className="flex h-full flex-col">
    <div className="border-b px-3 py-2 md:px-4"><TabsList aria-label={t("bonusPage")}><TabsTrigger value="monthly">{t("monthlyBonuses")}</TabsTrigger><TabsTrigger value="quarterly">{t("quarterlyBonus")}</TabsTrigger><TabsTrigger value="history">{t("bonusHistory")}</TabsTrigger></TabsList></div>
    <TabsContent value="monthly" className="mt-0 min-h-0 flex-1"><BonusDashboardClient key={`${shopId}:${requestedMonth ?? ""}`} requestedMonth={requestedMonth} /></TabsContent>
    <TabsContent value="quarterly" className="mt-0 min-h-0 flex-1"><QuarterlyBonusClient key={`${shopId}:${requestedQuarter ?? requestedMonth ?? ""}`} requestedMonth={requestedMonth} requestedQuarter={requestedQuarter} /></TabsContent>
    <TabsContent value="history" className="mt-0 min-h-0 flex-1"><BonusHistoryClient shopId={shopId} detail={historyDetail} /></TabsContent>
  </Tabs>;
  return (
    <div className="flex min-h-64 items-center justify-center p-6">
      {routeShop
        ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
        : <p>{t("shopNotFound")}</p>}
    </div>
  );
}
