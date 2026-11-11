import { useState } from "react";
import { ChartPie, Gift, LayoutDashboard, Menu, Trophy } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { ManagerMenuSheet } from "@/components/manager/manager-menu";
import Link, { usePathname } from "@/lib/navigation";
import { managerBasePath } from "@/lib/manager-mode";
import { cn } from "@/lib/utils";

export function useManagerTabs() {
  const t = useTranslations("Manager");
  const locale = useLocale();
  const pathname = usePathname().replace(/\/$/, "");
  const base = managerBasePath(locale);
  return [
    { href: base, icon: LayoutDashboard, label: t("tabs.dashboard") },
    { href: `${base}/rankings`, icon: Trophy, label: t("tabs.rankings") },
    { href: `${base}/bonuses`, icon: Gift, label: t("tabs.bonuses") },
    { href: `${base}/reports`, icon: ChartPie, label: t("tabs.reports") },
  ].map(tab => ({ ...tab, isActive: pathname === tab.href || (tab.href !== base && pathname.startsWith(`${tab.href}/`)) }));
}

/** Round bottom-bar button, and the dark pill the active tab grows into. Shared with the main phone bar. */
export const navCircleClass = "manager-card flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-[transform,background-color] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&_svg]:h-5 [&_svg]:w-5";
export const navPillActiveClass = "flex h-11 min-w-0 shrink items-center gap-1.5 rounded-full bg-foreground px-3.5 text-sm font-medium text-background shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0";

/**
 * The manager app's tabs plus Menu as separate round buttons above the bottom edge; the active tab
 * grows into a dark pill with its name. Shown on every page in manager mode.
 */
export function ManagerBottomNav({ className }: { className?: string }) {
  const t = useTranslations("Manager");
  const tabs = useManagerTabs();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
    <nav
      aria-label={t("navigation")}
      className={cn("pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3", className)}
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5">
        {tabs.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.isActive ? "page" : undefined}
            aria-label={tab.isActive ? undefined : tab.label}
            className={tab.isActive ? navPillActiveClass : navCircleClass}
          >
            <tab.icon aria-hidden="true" />
            {tab.isActive && <><span className="truncate">{tab.label}</span><span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-background" /></>}
          </Link>
        ))}
        <button type="button" aria-label={t("tabs.menu")} aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)} className={navCircleClass}>
          <Menu aria-hidden="true" />
        </button>
      </div>
    </nav>
    <ManagerMenuSheet open={menuOpen} onOpenChange={setMenuOpen} />
    </>
  );
}
