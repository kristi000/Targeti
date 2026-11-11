import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarRange, ChevronRight, ClipboardCheck, KeyRound, Languages, Lightbulb, ListChecks, LogOut, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { useManagerShop } from "@/components/manager/manager-provider";
import { displayShopName } from "@/components/dashboard-ui";
import { RestrictedAccessDialog } from "@/components/restricted-access";
import { useShop } from "@/components/shop-provider";
import { SidebarActions } from "@/components/sidebar-actions";
import { useTheme } from "@/components/theme-provider";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { dashboardPeriodsQueryOptions } from "@/lib/dashboard-queries";
import { managerBasePath, useClassicViewPreference } from "@/lib/manager-mode";
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation";

/** The manager app's "Menu" tab: full pages for data entry, report access, and settings. */
export function ManagerMenuSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Manager");
  const sidebar = useTranslations("Sidebar");
  const restricted = useTranslations("RestrictedAccess");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shop] = useManagerShop();
  const { theme, toggleTheme } = useTheme();
  const [, setClassic] = useClassicViewPreference();
  const access = useRestrictedAccess();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const base = shop ? `/${locale}/shop/${shop.id}` : null;
  const { selectedShop, setSelectedShop, isAdmin, actor } = useShop();
  const canEdit = actor.role !== "viewer";
  const periodsQuery = useQuery({ ...dashboardPeriodsQueryOptions(), enabled: open });
  const month = periodsQuery.data?.[0]?.month;

  // The shop tools act on the selected shop, so point it at the manager's shop while the menu is open.
  useEffect(() => {
    if (open && shop && selectedShop?.id !== shop.id) setSelectedShop(shop);
  }, [open, shop, selectedShop?.id, setSelectedShop]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const switchLocale = () => {
    const next = locale === "en" ? "sq" : "en";
    const query = searchParams.toString();
    onOpenChange(false);
    router.push(`${pathname.replace(`/${locale}`, `/${next}`)}${query ? `?${query}` : ""}`);
    router.refresh();
  };
  const openClassicView = () => {
    setClassic(true);
    go(`/${locale}`);
  };
  const logOut = async () => {
    onOpenChange(false);
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="manager-ui bg-background max-h-[85svh] overflow-y-auto rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
          <SheetHeader className="text-left">
            <SheetTitle>{t("menu.title")}</SheetTitle>
            <SheetDescription>{shop ? displayShopName(shop.name) : t("noShop")}</SheetDescription>
          </SheetHeader>

          {base && (
            <MenuGroup title={t("menu.enterData")}>
              <MenuRow icon={ClipboardCheck} label={t("reports.dailyClosing")} onClick={() => go(`${base}/closing`)} />
              <MenuRow icon={CalendarRange} label={t("reports.attendance")} onClick={() => go(`${managerBasePath(locale)}/reports/shifts`)} />
              <MenuRow icon={ListChecks} label={t("reports.procedures")} onClick={() => go(`${managerBasePath(locale)}/reports/procedures?add=1`)} />
            </MenuGroup>
          )}

          {canEdit && shop && selectedShop?.id === shop.id && month && (
            <MenuGroup title={t("menu.shopTools", { shop: displayShopName(shop.name) })}>
              <SidebarActions scope="shop" layout="menu" activeMonth={month} onNavigate={go} />
            </MenuGroup>
          )}

          {(canEdit || isAdmin) && (
            <MenuGroup title={t("menu.management")}>
              <SidebarActions scope="dashboard" layout="menu" />
            </MenuGroup>
          )}

          <MenuGroup title={t("menu.morePages")}>
            {base && <MenuRow icon={BarChart3} label={t("menu.shopPerformance")} onClick={() => go(base)} />}
            <MenuRow icon={Lightbulb} label={sidebar("insights")} onClick={() => go(`/${locale}/insights`)} />
            {access.data === false && <MenuRow icon={KeyRound} label={restricted("unlockReports")} onClick={() => { onOpenChange(false); setUnlockOpen(true); }} />}
          </MenuGroup>

          <MenuGroup title={sidebar("settings")}>
            <MenuRow icon={Languages} label={locale === "en" ? "Shqip" : "English"} onClick={switchLocale} />
            <MenuRow icon={theme === "dark" ? Sun : Moon} label={theme === "dark" ? sidebar("lightTheme") : sidebar("darkTheme")} onClick={toggleTheme} />
            <MenuRow icon={Monitor} label={t("classicView")} onClick={openClassicView} />
            <MenuRow icon={LogOut} label={sidebar("logOut")} onClick={() => void logOut()} destructive />
          </MenuGroup>
        </SheetContent>
      </Sheet>
      <RestrictedAccessDialog open={unlockOpen} onOpenChange={setUnlockOpen} onGranted={() => setUnlockOpen(false)} />
    </>
  );
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="glass divide-y divide-border/60 overflow-hidden rounded-2xl">{children}</div>
    </div>
  );
}

function MenuRow({ icon: Icon, label, onClick, destructive }: { icon: LucideIcon; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm active:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${destructive ? "text-destructive" : ""}`}
    >
      <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!destructive && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}
