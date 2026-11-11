import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "use-intl";

import { useShop } from "@/components/shop-provider";
import { dashboardPeriodsQueryOptions } from "@/lib/dashboard-queries";
import { managerBasePath, useStoredManagerShopId } from "@/lib/manager-mode";
import { getCurrentReportingMonth } from "@/lib/reporting-month";
import type { Shop } from "@/lib/types";

type ManagerContextValue = {
  /** The shop the manager app shows; Fresku by default. */
  shop: Shop | null;
  setShopId: (shopId: string) => void;
  /** Latest reporting month with data. */
  month: string;
  locale: string;
  basePath: string;
};

const ManagerContext = createContext<ManagerContextValue | null>(null);

const homeShopPattern = /fresku/i;

/** The shop the manager app shows, also usable outside the provider (on the full pages it links to). */
export function useManagerShop() {
  const { shops } = useShop();
  const [storedShopId, setShopId] = useStoredManagerShopId();
  const shop = shops.find(item => item.id === storedShopId)
    ?? shops.find(item => homeShopPattern.test(item.name))
    ?? shops[0]
    ?? null;
  return [shop, setShopId] as const;
}

export function ManagerProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [shop, setShopId] = useManagerShop();
  const periodsQuery = useQuery(dashboardPeriodsQueryOptions());
  const month = periodsQuery.data?.[0]?.month ?? getCurrentReportingMonth();

  const value = useMemo(() => ({ shop, setShopId, month, locale, basePath: managerBasePath(locale) }), [shop, setShopId, month, locale]);
  return <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>;
}

export function useManager() {
  const context = useContext(ManagerContext);
  if (!context) throw new Error("useManager must be used within a ManagerProvider");
  return context;
}
