import { useState } from "react";
import { AlignLeft, Check, ChevronDown, Store } from "lucide-react";
import { Outlet } from "react-router";
import { useLocale, useTranslations } from "use-intl";

import { ManagerBottomNav, useManagerTabs } from "@/components/manager/manager-bottom-nav";
import { ManagerMenuSheet } from "@/components/manager/manager-menu";
import { ManagerProvider, useManager } from "@/components/manager/manager-provider";
import { displayShopName } from "@/components/dashboard-ui";
import { useShop } from "@/components/shop-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/toaster";
import { formatReportingMonth } from "@/lib/reporting-month";

/** Shell of the manager mobile app: a light header, the active tab, and the floating bottom bar. */
export function ManagerLayout() {
  return (
    <ManagerProvider>
      <div className="manager-ui flex min-h-svh flex-col bg-background">
        <ManagerHeader />
        <main data-page-enter className="mx-auto w-full max-w-xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-1">
          <Outlet />
        </main>
        <ManagerBottomNav />
        <Toaster />
      </div>
    </ManagerProvider>
  );
}

const squareButton = "manager-card flex h-10 shrink-0 items-center justify-center rounded-2xl transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function ManagerHeader() {
  const t = useTranslations("Manager");
  const locale = useLocale();
  const { shops, actor } = useShop();
  const { shop, setShopId, month } = useManager();
  const tabs = useManagerTabs();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = tabs.find(tab => tab.isActive);
  const firstName = actor.name.replace(/^@/, "").split(/\s+/)[0] || actor.username;
  const onDashboard = active === tabs[0];

  return (
    <header className="sticky top-0 z-30 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
        <button type="button" aria-label={t("menu.title")} aria-haspopup="dialog" onClick={() => setMenuOpen(true)} className={`${squareButton} w-10`}>
          <AlignLeft aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold leading-tight tracking-tight">
            {onDashboard ? t("header.greeting", { name: firstName }) : active?.label ?? t("tabs.dashboard")}
          </h1>
          <p className="truncate text-xs text-muted-foreground">{formatReportingMonth(month, locale)}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t("chooseShop")} className={`${squareButton} max-w-[42%] gap-1.5 px-3 text-sm font-medium`}>
              <Store aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="truncate">{shop ? displayShopName(shop.name) : t("noShop")}</span>
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60svh] w-60 overflow-y-auto">
            <DropdownMenuLabel>{t("chooseShop")}</DropdownMenuLabel>
            {shops.map(item => (
              <DropdownMenuItem key={item.id} onSelect={() => setShopId(item.id)} className="gap-2">
                <Check aria-hidden="true" className={item.id === shop?.id ? "h-4 w-4 text-primary" : "h-4 w-4 opacity-0"} />
                <span className="truncate">{displayShopName(item.name)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span aria-hidden="true" className={`${squareButton} w-10 bg-primary text-sm font-semibold text-primary-foreground`}>
          {firstName.charAt(0).toUpperCase()}
        </span>
      </div>
      <ManagerMenuSheet open={menuOpen} onOpenChange={setMenuOpen} />
    </header>
  );
}
