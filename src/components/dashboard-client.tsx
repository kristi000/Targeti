import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams, replaceUrl } from "@/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useLocale, useTranslations } from "use-intl";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  Search,
  Store,
  Target,
  TrendingUp,
  Trophy,
  UserRoundCog,
  Wallet,
  X,
  Loader2,
  Medal,
} from "lucide-react";

import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { formatReportingMonth, resolveReportingMonth } from "@/lib/reporting-month";
import { KpiTile, ShopName, achievementTone, displayShopName, metricShortLabel } from "@/components/dashboard-ui";
import { KpiCardList, KpiTable, WEAK_FORECAST_THRESHOLD, collectMetricColumns, compareNullable, isWeakMetric, metricSortValue, type CardView, type KpiCellMode, type KpiSort, type KpiSortKey, type KpiTableRow } from "@/components/dashboard-kpi-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { exportReport } from "@/lib/report-export";
import type { DashboardMetric, DashboardRow } from "@/lib/dashboard-types";
import { dashboardPageQueryOptions, dashboardPeriodsQueryOptions } from "@/lib/dashboard-queries";
import { dashboardViewQuery, readDashboardView, type DashboardView } from "@/lib/dashboard-navigation";
import { useDashboardNavigation } from "@/components/dashboard-navigation-provider";

type ShopPerformanceRow = DashboardRow;

const emptyShopRows: ShopPerformanceRow[] = [];
const previewLimit = 10;

const shopColumns: ColumnDef<ShopPerformanceRow>[] = [
  { id: "shop", accessorFn: row => row.shop.name },
  { id: "achievement", accessorKey: "totalAchievement" },
  { id: "forecast", accessorKey: "forecastAchievement" },
  { id: "revenue", accessorKey: "revenue" },
];

export function DashboardClient({ bootstrapPending = false }: { bootstrapPending?: boolean }) {
  const { shops, supervisors, loading, setSelectedDatasetId } = useShop();
  const { rememberDashboardQuery } = useDashboardNavigation();
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = readDashboardView(searchParams);
  const [shopSearch, setShopSearch] = useState(view.search);
  const search = shopSearch.trim();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const selectedSupervisorId = view.supervisorId;
  const sorting = useMemo<SortingState>(() => [{ id: view.sortBy, desc: view.sortDescending }], [view.sortBy, view.sortDescending]);
  const [canFetch, setCanFetch] = useState(false);
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DashboardTab>("shops");
  const [expandedTabs, setExpandedTabs] = useState<Partial<Record<DashboardTab, string | null>>>({});
  const [cellMode, setCellMode] = useState<KpiCellMode>("progress");
  const [metricSort, setMetricSort] = useState<KpiSort | null>(null);
  const [supervisorSort, setSupervisorSort] = useState<KpiSort>({ key: "total", desc: true });
  const [representativeSort, setRepresentativeSort] = useState<KpiSort>({ key: "total", desc: true });
  const [supervisorQuery, setSupervisorQuery] = useState("");
  const [repQuery, setRepQuery] = useState("");
  const [repShopId, setRepShopId] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [cardView, setCardView] = useState<CardView>(readCardView);
  const changeCardView = (next: CardView) => {
    setCardView(next);
    try { localStorage.setItem(cardViewKey, next); } catch { /* the choice still applies for this visit */ }
  };

  // Existing query entries hydrate after commit. Let that finish before a
  // remount can start a redundant fetch of the stale client cache.
  useEffect(() => { if (!bootstrapPending) setCanFetch(true); }, [bootstrapPending]);

  useEffect(() => {
    // Native history updates are transitions. Ignore an intermediate URL while
    // a newer keystroke already changed it, but restore drafts on history moves.
    const currentSearch = readDashboardView(new URLSearchParams(window.location.search)).search;
    if (view.search === currentSearch) setShopSearch(view.search);
  }, [view.search]);

  useEffect(() => {
    if (search === debouncedSearch) return;
    if (!search) { setDebouncedSearch(""); return; }
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search, debouncedSearch]);

  const queriesEnabled = canFetch && !bootstrapPending;
  const periodsQuery = useQuery({ ...dashboardPeriodsQueryOptions(), enabled: queriesEnabled });
  const requestedMonth = view.month;
  const activeDatasetId = resolveReportingMonth(periodsQuery.data ?? [], requestedMonth);

  const pageQuery = useQuery({
    ...dashboardPageQueryOptions({ ...view, month: activeDatasetId, search: debouncedSearch }),
    enabled: queriesEnabled && periodsQuery.data !== undefined,
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === activeDatasetId
      && previousQuery.queryKey[3] === selectedSupervisorId ? previousData : undefined,
  });

  const supervisorsById = useMemo(() => new Map(supervisors.map(supervisor => [supervisor.id, supervisor.name])), [supervisors]);
  const supervisorIdsByShop = useMemo(() => new Map(shops.map(shop => [shop.id, shop.supervisorId])), [shops]);

  const changeView = (updates: Partial<DashboardView>) => {
    const query = dashboardViewQuery({ ...view, month: activeDatasetId, ...updates });
    const href = `${pathname}?${query}`;
    if (`${window.location.pathname}${window.location.search}` !== href) replaceUrl(href);
    rememberDashboardQuery(query);
  };

  const table = useReactTable({
    data: pageQuery.data?.rows ?? emptyShopRows,
    columns: shopColumns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    autoResetPageIndex: false,
    state: { sorting },
    onSortingChange: updater => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const sort = next[0] ?? { id: "achievement", desc: true };
      changeView({ sortBy: sort.id as DashboardView["sortBy"], sortDescending: sort.desc });
    },
  });

  const updateSearch = (value: string) => {
    setShopSearch(value);
    changeView({ search: value });
    if (!value.trim()) setDebouncedSearch("");
  };

  const selectSupervisor = (supervisorId: string) => {
    const isSelected = selectedSupervisorId === supervisorId;
    changeView({ supervisorId: isSelected ? null : supervisorId, ...(!isSelected ? { search: "" } : {}) });
    if (!isSelected) { setShopSearch(""); setDebouncedSearch(""); }
  };

  useEffect(() => {
    if (!periodsQuery.data) return;
    rememberDashboardQuery(dashboardViewQuery({ month: activeDatasetId, search: shopSearch, supervisorId: selectedSupervisorId, sortBy: sorting[0].id as DashboardView["sortBy"], sortDescending: sorting[0].desc }));
    setSelectedDatasetId(activeDatasetId);
  }, [activeDatasetId, shopSearch, selectedSupervisorId, sorting, periodsQuery.data, rememberDashboardQuery, setSelectedDatasetId]);

  if (shops.length === 0) {
    return <div className="relative flex h-full flex-col items-center justify-center gap-3"><SidebarTrigger className="absolute left-3 top-3 h-9 w-9" /><p className="text-muted-foreground">Add a shop to start tracking performance.</p></div>;
  }

  const missingData = !periodsQuery.data || !pageQuery.data;
  if (missingData && (periodsQuery.isError || pageQuery.isError) && !bootstrapPending) {
    return <div className="flex h-full flex-col items-center justify-center gap-3"><p role="alert" className="text-muted-foreground">{t("loadFailed")}</p><Button onClick={() => { void periodsQuery.refetch(); void pageQuery.refetch(); }}>{t("retry")}</Button></div>;
  }
  if (loading || missingData) {
    return <div role="status" className="flex h-full items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</div>;
  }

  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  const compactCurrency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", notation: "compact", maximumFractionDigits: 1 });
  const currencies = { compact: compactCurrency, full: currency };
  const shopViewKey = dashboardViewQuery({ ...view, month: activeDatasetId, search });
  const resultCount = pageQuery.data?.total ?? 0;
  const selectedSupervisor = supervisors.find(supervisor => supervisor.id === selectedSupervisorId);
  const summary = pageQuery.data?.summary;
  const hasSummaryData = Boolean(summary && (summary.revenue > 0 || summary.average > 0));
  const formatPercent = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
  const supervisorRows = pageQuery.data?.supervisorRows ?? [];
  const representativeRows = pageQuery.data?.representativeRows ?? [];

  // Shops: server sort for the fixed columns, client sort when a KPI column is picked.
  const serverSort = sorting[0] ?? { id: "achievement", desc: true };
  const shopSort: KpiSort = metricSort ?? { key: shopSortKeys[serverSort.id as DashboardView["sortBy"]] ?? "total", desc: serverSort.desc };
  const shopRows = table.getRowModel().rows.map(row => row.original);
  const sortedShopRows = metricSort
    ? [...shopRows].sort((left, right) => compareNullable(metricSortValue(left.metrics, metricSort.key.slice(7)), metricSortValue(right.metrics, metricSort.key.slice(7)), metricSort.desc))
    : shopRows;
  const shopTableRows: KpiTableRow[] = sortedShopRows.map(item => {
    const supervisorName = supervisorsById.get(supervisorIdsByShop.get(item.shop.id) ?? "") ?? "Unassigned";
    return {
      key: item.shop.id,
      name: <ShopName name={item.shop.name} />,
      plainName: item.shop.name,
      detail: supervisorName,
      plainDetail: supervisorName,
      total: item.hasData ? item.totalAchievement : null,
      change: item.hasData && typeof item.previousAchievement === "number" ? item.totalAchievement - item.previousAchievement : null,
      forecast: item.forecastAchievement,
      isFinal: item.isFinal,
      revenue: item.revenue,
      metrics: item.metrics,
      ariaLabel: `Open ${item.shop.name}`,
      onOpen: () => router.push(`/${locale}/shop/${item.shop.id}?month=${activeDatasetId}`),
    };
  });

  const supervisorQueryText = supervisorQuery.trim().toLocaleLowerCase(locale);
  const supervisorTableRows: KpiTableRow[] = sortPeople(
    supervisorRows.filter(row => !supervisorQueryText || row.name.toLocaleLowerCase(locale).includes(supervisorQueryText)),
    supervisorSort,
    row => ({ name: row.name, total: row.activeShops ? row.averageAchievement : null, forecast: row.forecastAchievement, revenue: row.revenue, metrics: row.metrics }),
  ).map(row => {
    const detail = `${row.shopCount} shop${row.shopCount === 1 ? "" : "s"} · ${row.shopsAtTarget} at target`;
    return {
      key: row.id,
      name: <span className="font-medium text-foreground">{row.name}</span>,
      plainName: row.name,
      detail,
      plainDetail: detail,
      total: row.activeShops ? row.averageAchievement : null,
      forecast: row.forecastAchievement,
      revenue: row.revenue,
      metrics: row.metrics,
      selected: selectedSupervisorId === row.id,
      ariaLabel: `Show ${row.name}'s shops`,
      onOpen: () => { if (selectedSupervisorId !== row.id) selectSupervisor(row.id); setActiveTab("shops"); },
    };
  });

  const representativeShops = Array.from(new Map(representativeRows.map(row => [row.shopId, { id: row.shopId, name: row.shopName }])).values())
    .sort((left, right) => left.name.localeCompare(right.name, locale));
  const effectiveRepShopId = representativeShops.some(shop => shop.id === repShopId) ? repShopId : "all";
  const repQueryText = repQuery.trim().toLocaleLowerCase(locale);
  const representativeTableRows: KpiTableRow[] = sortPeople(
    representativeRows.filter(rep => (effectiveRepShopId === "all" || rep.shopId === effectiveRepShopId)
      && (!repQueryText || `${rep.name} ${rep.shopName}`.toLocaleLowerCase(locale).includes(repQueryText))),
    representativeSort,
    rep => ({ name: rep.name, total: rep.achievement, forecast: rep.forecastAchievement, revenue: null, metrics: rep.metrics }),
  ).map(rep => ({
    key: `${rep.shopId}-${rep.id}`,
    name: <span className="font-medium text-foreground">{rep.name}</span>,
    plainName: rep.name,
    detail: <ShopName name={rep.shopName} className="font-normal text-muted-foreground" />,
    plainDetail: rep.shopName,
    total: rep.achievement,
    forecast: rep.forecastAchievement,
    isFinal: rep.forecastAchievement === null,
    metrics: rep.metrics,
    ariaLabel: `Open ${rep.name} in ${rep.shopName}`,
    onOpen: () => router.push(`/${locale}/shop/${rep.shopId}?month=${activeDatasetId}#representative-bonuses`),
  }));

  const tabRows = activeTab === "shops" ? shopTableRows : activeTab === "supervisors" ? supervisorTableRows : representativeTableRows;
  const expandedKey = activeTab === "shops" ? shopViewKey : activeTab;
  const tabExpanded = expandedTabs[activeTab] === expandedKey;
  const visibleTabRows = tabExpanded ? tabRows : tabRows.slice(0, previewLimit);
  const tabSort = activeTab === "shops" ? shopSort : activeTab === "supervisors" ? supervisorSort : representativeSort;
  const nameLabel = activeTab === "shops" ? "Shop" : activeTab === "supervisors" ? "Supervisor" : "Representative";
  const weakCount = tabRows.reduce((count, row) => count + (row.metrics?.filter(isWeakMetric).length ?? 0), 0);

  const applySort = (next: KpiSort) => {
    if (activeTab === "supervisors") { setSupervisorSort(next); return; }
    if (activeTab === "representatives") { setRepresentativeSort(next); return; }
    if (next.key.startsWith("metric:")) { setMetricSort(next); return; }
    setMetricSort(null);
    table.setSorting([{ id: Object.entries(shopSortKeys).find(([, value]) => value === next.key)?.[0] ?? "achievement", desc: next.desc }]);
  };
  // Name sorts A–Z first; KPIs lowest first, to find problems; totals highest first.
  const defaultDirection = (key: KpiSortKey) => key === "name" ? false : !key.startsWith("metric:");
  const onSort = (key: KpiSortKey) => applySort(tabSort.key === key ? { key, desc: !tabSort.desc } : { key, desc: defaultDirection(key) });
  const sortOptions = [
    { value: "total", label: "Total" },
    { value: "forecast", label: "EOM forecast" },
    ...(activeTab !== "representatives" ? [{ value: "revenue", label: "Revenue" }] : []),
    { value: "name", label: "Name" },
    ...collectMetricColumns(tabRows).map(metric => ({ value: `metric:${metric.id}`, label: metricShortLabel(metric) })),
  ];

  const exportTab = async () => {
    setExporting(true);
    try {
      const columns = collectMetricColumns(tabRows);
      const percent = "0.0";
      await exportReport<KpiTableRow>({
        rows: tabRows,
        fileName: `dashboard-${activeTab}-${activeDatasetId}`,
        sheetName: nameLabel,
        format: "xlsx",
        columns: [
          { header: "#", value: row => tabRows.indexOf(row) + 1, numberFormat: "0", width: 6 },
          { header: nameLabel, value: row => row.plainName, width: 28 },
          { header: activeTab === "representatives" ? "Shop" : activeTab === "shops" ? "Supervisor" : "Shops", value: row => row.plainDetail, width: 24 },
          { header: "Total %", value: row => row.total ?? "", numberFormat: percent },
          ...(activeTab === "shops" ? [{ header: "Change since last import", value: (row: KpiTableRow) => row.change ?? "", numberFormat: "+0.0;-0.0;0.0" }] : []),
          { header: "EOM forecast %", value: row => row.isFinal ? "Final" : row.forecast ?? "", numberFormat: percent },
          ...(activeTab !== "representatives" ? [{ header: "Revenue (ALL)", value: (row: KpiTableRow) => row.revenue ?? "", numberFormat: "#,##0", width: 14 }] : []),
          ...columns.flatMap(column => {
            const find = (row: KpiTableRow) => row.metrics?.find(metric => metric.id === column.id);
            const label = metricShortLabel(column);
            return [
              { header: `${label} %`, value: (row: KpiTableRow) => find(row)?.achievement ?? "", numberFormat: percent, width: 11 },
              { header: `${label} actual`, value: (row: KpiTableRow) => find(row)?.actual ?? "", numberFormat: "#,##0.##", width: 11 },
              { header: `${label} target`, value: (row: KpiTableRow) => find(row)?.target ?? "", numberFormat: "#,##0.##", width: 11 },
              { header: `${label} forecast %`, value: (row: KpiTableRow) => find(row)?.forecast ?? "", numberFormat: percent, width: 12 },
              { header: `${label} needed/day`, value: (row: KpiTableRow) => find(row)?.neededPerDay ?? "", numberFormat: "#,##0.0", width: 12 },
            ];
          }),
        ],
      });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Export failed", description: "The table could not be exported. Try again." });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-[calc(100svh-var(--bottom-nav-height))] flex-col">
      <main ref={element => { if (element) element.inert = bootstrapPending; }} aria-busy={bootstrapPending || pageQuery.isFetching} className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5 xl:overflow-hidden">
        <div className="mx-auto flex min-h-full max-w-[1920px] flex-col gap-4 xl:h-full">
          <header className="flex shrink-0 items-center gap-3">
            <SidebarTrigger className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground md:text-xl">{t("overviewTitle")}</h1>
              <p className="truncate text-xs text-muted-foreground md:text-sm">
                {formatReportingMonth(activeDatasetId, locale)}
                {selectedSupervisor && <> · {selectedSupervisor.name}</>}
              </p>
            </div>
            {(bootstrapPending || pageQuery.isFetching) && <p role="status" className="glass-pill flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /><span className="hidden sm:inline">{t("refreshing")}</span></p>}
          </header>

          <section aria-label={t("overviewTitle")} className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              icon={Target}
              label={t("averagePerformanceLabel")}
              value={hasSummaryData ? formatPercent(summary?.average) : "—"}
              tone={hasSummaryData ? achievementTone(summary?.average) : "muted"}
              hint={summary?.allFinal ? t("finalResults") : t("monthToDate")}
            />
            <KpiTile
              icon={TrendingUp}
              label={t("eomForecast")}
              value={!hasSummaryData ? "—" : summary?.allFinal ? t("final") : formatPercent(summary?.forecast)}
              tone={hasSummaryData && !summary?.allFinal ? achievementTone(summary?.forecast) : "muted"}
              hint={summary?.allFinal ? t("monthClosed") : t("currentPace")}
            />
            <KpiTile
              icon={Wallet}
              label={t("totalRevenue")}
              value={hasSummaryData ? compactCurrency.format(summary?.revenue ?? 0) : "—"}
              hint={hasSummaryData ? currency.format(summary?.revenue ?? 0) : t("noDataYet")}
            />
            <KpiTile
              icon={Trophy}
              label={t("shopsAtTarget")}
              value={hasSummaryData ? `${summary?.shopsAtTarget ?? 0} / ${summary?.activeShops ?? 0}` : "—"}
              hint={t("shopsAtTargetHint")}
            />
          </section>

          <Tabs value={activeTab} onValueChange={value => setActiveTab(value as DashboardTab)} aria-busy={search !== debouncedSearch || pageQuery.isFetching} className="glass flex min-h-[32rem] min-w-0 flex-1 flex-col overflow-hidden rounded-[calc(var(--radius)+6px)] xl:min-h-0">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
              <TabsList className="h-9 w-full md:w-auto">
                <TabsTrigger value="shops" className="flex-1 gap-1.5 px-2 text-xs md:flex-none md:px-3"><Store aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />Shops<span className="tabular-nums text-muted-foreground">{resultCount}</span></TabsTrigger>
                <TabsTrigger value="supervisors" className="flex-1 gap-1.5 px-2 text-xs md:flex-none md:px-3"><UserRoundCog aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />Supervisors<span className="tabular-nums text-muted-foreground">{supervisorRows.length}</span></TabsTrigger>
                <TabsTrigger value="representatives" className="flex-1 gap-1.5 px-2 text-xs md:flex-none md:px-3"><Medal aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />{t("salesRepsTab")}<span className="tabular-nums text-muted-foreground">{representativeRows.length}</span></TabsTrigger>
              </TabsList>
              {selectedSupervisor && <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 rounded-full bg-indigo-500/10 px-2.5 text-xs text-indigo-700 hover:bg-indigo-500/15 dark:text-indigo-300" onClick={() => selectSupervisor(selectedSupervisor.id)} aria-label={`Show all shops instead of ${selectedSupervisor.name}'s shops`}>{selectedSupervisor.name}<X className="h-3.5 w-3.5" /></Button>}

              <div className="ml-auto flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">
                <div className="relative min-w-0 basis-full md:w-56 md:flex-none md:basis-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  {activeTab === "shops" && <Input value={shopSearch} maxLength={120} onChange={event => updateSearch(event.target.value)} placeholder="Search shops or supervisors…" aria-label="Search shops or supervisors" className="h-8 pl-8 text-sm" />}
                  {activeTab === "supervisors" && <Input value={supervisorQuery} maxLength={120} onChange={event => setSupervisorQuery(event.target.value)} placeholder="Search supervisors…" aria-label="Search supervisors" className="h-8 pl-8 text-sm" />}
                  {activeTab === "representatives" && <Input value={repQuery} maxLength={120} onChange={event => setRepQuery(event.target.value)} placeholder="Search representatives…" aria-label="Search representatives" className="h-8 pl-8 text-sm" />}
                </div>
                {activeTab === "representatives" && <AppSelect value={effectiveRepShopId} onValueChange={setRepShopId} aria-label="Filter representatives by shop" className="h-8 shrink-0 max-md:basis-full md:w-36" options={[{ value: "all", label: "All shops" }, ...representativeShops.map(shop => ({ value: shop.id, label: displayShopName(shop.name) }))]} />}
                <div role="group" aria-label="Card view" className="flex h-8 shrink-0 items-center rounded-full bg-foreground/[0.06] p-0.5 text-xs md:hidden">
                  {([["simple", "Simple"], ["detailed", "Detailed"]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={cardView === mode} onClick={() => changeCardView(mode)} className={cn("h-7 rounded-full px-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground", cardView === mode && "bg-background text-foreground shadow-sm")}>{label}</button>)}
                </div>
                <AppSelect value={tabSort.key} onValueChange={value => applySort({ key: value as KpiSortKey, desc: defaultDirection(value as KpiSortKey) })} aria-label="Sort by" className="h-8 min-w-[6rem] flex-1 md:hidden" options={sortOptions} />
                <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0 md:hidden" onClick={() => applySort({ key: tabSort.key, desc: !tabSort.desc })} aria-label={tabSort.desc ? "Sort ascending" : "Sort descending"}>
                  {tabSort.desc ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
                <div role="group" aria-label="KPI detail" className={cn("h-8 shrink-0 items-center rounded-full bg-foreground/[0.06] p-0.5 text-xs md:flex", cardView === "detailed" ? "flex" : "hidden")}>
                  {([["progress", "Actual/target", "Actual/target"], ["perDay", "Needed per day", "Per day"]] as const).map(([mode, label, shortLabel]) => <button key={mode} type="button" aria-pressed={cellMode === mode} onClick={() => setCellMode(mode)} className={cn("h-7 rounded-full px-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground", cellMode === mode && "bg-background text-foreground shadow-sm")}><span className="hidden sm:inline">{label}</span><span className="sm:hidden">{shortLabel}</span></button>)}
                </div>
                <Button type="button" variant="outline" size="sm" aria-label="Export to Excel" className="h-8 shrink-0 gap-1.5 max-md:w-8 max-md:px-0" disabled={exporting || tabRows.length === 0} onClick={() => void exportTab()}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}<span className="max-md:sr-only">Export</span>
                </Button>
              </div>
            </div>

            <p className={cn("flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground", cardView === "simple" && "max-md:hidden")}>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-rose-500" />Forecast under {WEAK_FORECAST_THRESHOLD}%{weakCount > 0 && <span className="font-medium text-rose-700 dark:text-rose-400">· {weakCount} KPI{weakCount === 1 ? "" : "s"}</span>}</span>
              {activeTab === "shops" && <span>▲▼ change since the previous import</span>}
              {cellMode === "perDay" && <span>Sales per remaining day to reach 100%</span>}
              {activeTab === "supervisors" && <span>KPIs averaged across each supervisor&apos;s shops · select a row to filter shops</span>}
            </p>

            <div className="min-h-0 flex-1 overflow-auto">
              {visibleTabRows.length > 0 && <div className="hidden md:block"><KpiTable rows={visibleTabRows} nameLabel={nameLabel} sort={tabSort} onSort={onSort} cellMode={cellMode} currency={currencies} showRevenue={activeTab !== "representatives"} /></div>}
              {visibleTabRows.length > 0 && <div className="md:hidden"><KpiCardList rows={visibleTabRows} view={cardView} cellMode={cellMode} /></div>}
              {visibleTabRows.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                {activeTab === "shops" ? "No shops match your search." : activeTab === "supervisors" ? "No supervisors match." : "No representatives match these filters."}
              </div>}
            </div>

            {tabRows.length > previewLimit && <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-3 py-2">
              <p className="text-xs text-muted-foreground">{t("showingShops", { shown: visibleTabRows.length, total: tabRows.length })}</p>
              <Button type="button" variant="ghost" size="sm" className="h-8" aria-expanded={tabExpanded} onClick={() => setExpandedTabs(current => ({ ...current, [activeTab]: tabExpanded ? null : expandedKey }))}>
                {tabExpanded ? <ChevronUp aria-hidden="true" className="mr-1.5 h-4 w-4" /> : <ChevronDown aria-hidden="true" className="mr-1.5 h-4 w-4" />}
                {tabExpanded ? t("showTopShops", { count: previewLimit }) : t("viewAllShops")}
              </Button>
            </div>}
          </Tabs>
        </div>
      </main>
    </div>
  );
}

type DashboardTab = "shops" | "supervisors" | "representatives";

const cardViewKey = "d-one-dashboard-card-view";

function readCardView(): CardView {
  try { return localStorage.getItem(cardViewKey) === "detailed" ? "detailed" : "simple"; } catch { return "simple"; }
}

const shopSortKeys: Record<DashboardView["sortBy"], KpiSortKey> = { shop: "name", achievement: "total", forecast: "forecast", revenue: "revenue" };

type PeopleSortValues = { name: string; total: number | null; forecast: number | null; revenue: number | null; metrics?: DashboardMetric[] };

function sortPeople<Row>(rows: Row[], sort: KpiSort, values: (row: Row) => PeopleSortValues): Row[] {
  return [...rows].sort((leftRow, rightRow) => {
    const left = values(leftRow);
    const right = values(rightRow);
    if (sort.key === "name") return sort.desc ? right.name.localeCompare(left.name) : left.name.localeCompare(right.name);
    if (sort.key.startsWith("metric:")) {
      const id = sort.key.slice(7);
      return compareNullable(metricSortValue(left.metrics, id), metricSortValue(right.metrics, id), sort.desc);
    }
    const field = sort.key as "total" | "forecast" | "revenue";
    return compareNullable(left[field], right[field], sort.desc) || left.name.localeCompare(right.name);
  });
}
