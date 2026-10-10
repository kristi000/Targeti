"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type DashboardNavigationContextValue = {
  dashboardHref: string;
  rememberDashboardQuery: (query: string) => void;
};

const DashboardNavigationContext = createContext<DashboardNavigationContextValue | undefined>(undefined);

export function DashboardNavigationProvider({ children, locale }: { children: ReactNode; locale: string }) {
  const [dashboardQuery, setDashboardQuery] = useState("");
  const rememberDashboardQuery = useCallback((query: string) => setDashboardQuery(query), []);
  const value = useMemo(() => ({
    dashboardHref: `/${locale}${dashboardQuery ? `?${dashboardQuery}` : ""}`,
    rememberDashboardQuery,
  }), [locale, dashboardQuery, rememberDashboardQuery]);

  return <DashboardNavigationContext.Provider value={value}>{children}</DashboardNavigationContext.Provider>;
}

export function useDashboardNavigation() {
  const context = useContext(DashboardNavigationContext);
  if (!context) throw new Error("useDashboardNavigation must be used within a DashboardNavigationProvider");
  return context;
}
