import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Copy, ExternalLink, KeyRound, Loader2, Plus, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { useParams } from "react-router";
import { useLocale, useTranslations } from "use-intl";

import { AttendanceEntrySheet, ProcedureSheet, previousDayEntries, useSaveAttendanceDay, type ProcedureSheetState } from "@/components/manager/manager-entry";
import { useManager } from "@/components/manager/manager-provider";
import { Card, EmptyState, ErrorState, Initials, LoadingState, Percent, ProgressBar, Section, SegmentedControl, formatAmount } from "@/components/manager/manager-ui";
import { metricShortLabel } from "@/components/dashboard-ui";
import { RestrictedAccessDialog } from "@/components/restricted-access";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { useToast } from "@/hooks/use-toast";
import { fetchAttendanceMonth } from "@/server/actions/attendance";
import { fetchDailyActivityMonth } from "@/server/actions/daily-activity";
import { fetchMonthlyCellSummary, fetchMonthlyClosingSummary, fetchMonthlyDebts, fetchMonthlyUnsubscribes, handleUpdateDebt } from "@/server/actions/daily-closing";
import { fetchMonthlyBankReconciliation, saveMonthlyBankReconciliation } from "@/server/actions/monthly-bank";
import { fetchProcedures } from "@/server/actions/procedures";
import { attendanceQueryKey, monthDates, type AttendanceEntry, type AttendanceStaff } from "@/lib/attendance";
import { calculateDailyActivity, dailyActivityMonthQueryKey, getDailyActivityProcedureImpact } from "@/lib/daily-activity";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { managerBasePath, todayInTirana } from "@/lib/manager-mode";
import { monthlyBankQueryKey, saveMonthlyBankReconciliationSchema } from "@/lib/monthly-bank";
import { monthlyCellQueryKey, monthlyClosingQueryKey, monthlyDebtsQueryKey, monthlyUnsubscribesQueryKey, type MonthlyDebtRow } from "@/lib/monthly-closing";
import Link, { useSearchParams } from "@/lib/navigation";
import { proceduresQueryKey, type ProcedureFilter } from "@/lib/procedures";
import { formatReportingMonth } from "@/lib/reporting-month";
import type { PerformanceMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

export const managerReports = ["summary", "notes", "debts", "unsubscribes", "shifts", "procedures", "activity"] as const;
export type ManagerReport = (typeof managerReports)[number];
const restrictedReports = new Set<ManagerReport>(["summary", "notes", "debts", "unsubscribes"]);

/** Phone versions of the shop's read-only reports, opened from the Reports tab. */
export function ManagerReportPage() {
  const { report } = useParams();
  const t = useTranslations("Manager");
  const { shop, locale } = useManager();
  const [month, setMonth] = useState(() => todayInTirana().slice(0, 7));
  const valid = managerReports.includes(report as ManagerReport);
  const name = report as ManagerReport;

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href={`${managerBasePath(locale)}/reports`} aria-label={t("reportPages.back")} className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full active:bg-foreground/[0.06]">
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </Link>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{valid ? t(`reportPages.titles.${name}`) : t("tabs.reports")}</h2>
      </div>
      {!valid ? <EmptyState>{t("reportPages.notFound")}</EmptyState>
        : !shop ? <EmptyState>{t("noShop")}</EmptyState>
          : <>
            <MonthStepper month={month} onChange={setMonth} />
            <div className="mt-4">
              {restrictedReports.has(name)
                ? <AccessGate><ReportBody report={name} shopId={shop.id} month={month} /></AccessGate>
                : <ReportBody report={name} shopId={shop.id} month={month} />}
            </div>
          </>}
    </>
  );
}

function ReportBody({ report, shopId, month }: { report: ManagerReport; shopId: string; month: string }) {
  switch (report) {
    case "summary": return <SummaryReport shopId={shopId} month={month} />;
    case "notes": return <NotesReport shopId={shopId} month={month} />;
    case "debts": return <DebtsReport shopId={shopId} month={month} />;
    case "unsubscribes": return <UnsubscribesReport shopId={shopId} month={month} />;
    case "shifts": return <ShiftsReport shopId={shopId} month={month} />;
    case "procedures": return <ProceduresReport shopId={shopId} month={month} />;
    case "activity": return <ActivityReport shopId={shopId} month={month} />;
  }
}

function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function MonthStepper({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const t = useTranslations("Manager");
  const locale = useLocale();
  const current = todayInTirana().slice(0, 7);
  return (
    <div className="glass flex items-center justify-between rounded-2xl p-1">
      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("reportPages.previousMonth")} onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft aria-hidden="true" className="h-5 w-5" />
      </Button>
      <span className="text-sm font-medium">{formatReportingMonth(month, locale)}</span>
      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("reportPages.nextMonth")} disabled={month >= current} onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight aria-hidden="true" className="h-5 w-5" />
      </Button>
    </div>
  );
}

function AccessGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Manager");
  const restricted = useTranslations("RestrictedAccess");
  const access = useRestrictedAccess();
  const [open, setOpen] = useState(false);
  if (access.isPending) return <LoadingState />;
  if (access.data === true) return <>{children}</>;
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      <KeyRound aria-hidden="true" className="h-6 w-6" />
      <p>{t("reportPages.locked")}</p>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{restricted("unlockReports")}</Button>
      <RestrictedAccessDialog open={open} onOpenChange={setOpen} onGranted={() => setOpen(false)} />
    </div>
  );
}

/** Opens the full daily closing page on the given date. */
function DailyReportLink({ shopId, date }: { shopId: string; date: string }) {
  const t = useTranslations("Manager");
  const { locale } = useManager();
  return (
    <Link href={`/${locale}/shop/${shopId}/closing?date=${date}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
      {t("reportPages.openDay")}<ExternalLink aria-hidden="true" className="h-3 w-3" />
    </Link>
  );
}

function StatGrid({ items }: { items: Array<{ label: string; value: string; tone?: "good" | "bad" }> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(item => (
        <div key={item.label} className="glass min-w-0 rounded-2xl p-3">
          <p className="truncate text-xs text-muted-foreground">{item.label}</p>
          <p className={cn("mt-0.5 truncate text-lg font-semibold tabular-nums", item.tone === "bad" && "text-rose-600 dark:text-rose-400", item.tone === "good" && "text-emerald-700 dark:text-emerald-400")}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function useDayFormat() {
  const locale = useLocale();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return (date: string) => formatter.format(new Date(`${date}T00:00:00Z`));
  }, [locale]);
}

function SummaryReport({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("Manager");
  const closing = useTranslations("MonthlyClosing");
  const bank = useTranslations("MonthlyBank");
  const day = useDayFormat();
  const [open, setOpen] = useState<string | null>(null);
  const summary = useQuery({ queryKey: monthlyClosingQueryKey(shopId, month), queryFn: () => fetchMonthlyClosingSummary(shopId, month), staleTime: 0 });
  const bankQuery = useQuery({ queryKey: monthlyBankQueryKey(shopId, month), queryFn: () => fetchMonthlyBankReconciliation(shopId, month), staleTime: 15_000 });

  if (summary.isPending) return <LoadingState />;
  if (summary.isError) return <ErrorState onRetry={() => void summary.refetch()} />;
  const { totals, rows } = summary.data;

  return (
    <>
      <StatGrid items={[
        { label: closing("net"), value: formatAmount(totals.net) },
        { label: closing("boss"), value: formatAmount(totals.boss) },
        { label: closing("invoice"), value: formatAmount(totals.invoice) },
        { label: closing("unsubscribe"), value: formatAmount(totals.unsubscribe) },
      ]} />
      <p className="mt-2 text-[11px] text-muted-foreground">{closing("formula")}</p>

      <Section title={bank("title")}>
        {bankQuery.isPending ? <LoadingState />
          : bankQuery.isError ? <ErrorState onRetry={() => void bankQuery.refetch()} />
            : <BankDeposits shopId={shopId} month={month} data={bankQuery.data} totals={totals} />}
      </Section>

      <Section title={t("reportPages.days")} aside={closing("reports", { count: rows.length })}>
        {rows.length === 0 ? <EmptyState>{closing("empty")}</EmptyState> : (
          <Card className="divide-y divide-border/60 p-0">
            {[...rows].reverse().map(row => (
              <div key={row.date}>
                <button type="button" aria-expanded={open === row.date} onClick={() => setOpen(open === row.date ? null : row.date)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm">
                  <span className="min-w-0 flex-1">{day(row.date)}</span>
                  <span className={cn("font-semibold tabular-nums", row.net < 0 && "text-rose-600 dark:text-rose-400")}>{formatAmount(row.net)}</span>
                  <ChevronRight aria-hidden="true" className={cn("h-4 w-4 text-muted-foreground transition-transform", open === row.date && "rotate-90")} />
                </button>
                {open === row.date && (
                  <div className="space-y-1 px-4 pb-3 text-xs">
                    <Row label={closing("boss")} value={formatAmount(row.boss)} />
                    <Row label={closing("invoice")} value={formatAmount(row.invoice)} />
                    <Row label={closing("unsubscribe")} value={formatAmount(row.unsubscribe)} />
                    <DailyReportLink shopId={shopId} date={row.date} />
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </Section>
    </>
  );
}

type BankData = Awaited<ReturnType<typeof fetchMonthlyBankReconciliation>>;
type SaveError = "conflict" | "invalidData" | "sessionExpired" | "accessDenied" | "saveFailed";

/**
 * Bank deposits for the month. Each add or remove saves straight away with the month's revision,
 * so a change made meanwhile on another device is refused instead of overwritten.
 */
function BankDeposits({ shopId, month, data, totals }: { shopId: string; month: string; data: BankData; totals: { boss: number; invoice: number } }) {
  const t = useTranslations("Manager");
  const bank = useTranslations("MonthlyBank");
  const day = useDayFormat();
  const client = useQueryClient();
  const { toast } = useToast();
  const today = todayInTirana();
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(() => today.startsWith(month) ? today : `${month}-01`);
  const [amount, setAmount] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);

  const depositsTotal = data.deposits.reduce((sum, item) => sum + item.amount, 0);
  const difference = depositsTotal + data.carryover - totals.boss - totals.invoice;
  const amountValue = Number(amount);
  const formValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0 && amountValue <= 1_000_000_000;

  const save = async (deposits: BankData["deposits"]) => {
    const input = { shopId, month, expectedRevision: data.revision, deposits, carryover: data.carryover, carryoverNote: data.carryoverNote };
    if (!saveMonthlyBankReconciliationSchema.safeParse(input).success) { setError("invalidData"); return false; }
    setSaving(true);
    setError(null);
    try {
      const result = await saveMonthlyBankReconciliation(input);
      if (!result.success) {
        const code = result.error;
        setError(code === "conflict" || code === "invalidData" || code === "sessionExpired" || code === "accessDenied" ? code : "saveFailed");
        if (code === "conflict") void client.invalidateQueries({ queryKey: monthlyBankQueryKey(shopId, month) });
        return false;
      }
      client.setQueryData(monthlyBankQueryKey(shopId, month), result.data);
      toast({ title: bank("saved") });
      return true;
    } catch {
      setError("saveFailed");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const addDeposit = async () => {
    if (!formValid || saving) return;
    if (await save([...data.deposits, { id: crypto.randomUUID(), date, amount: amountValue }])) {
      setAdding(false);
      setAmount("");
    }
  };
  const removeDeposit = async (id: string) => {
    if (saving) return;
    if (await save(data.deposits.filter(item => item.id !== id))) setConfirmRemove(null);
  };

  return (
    <Card className="space-y-3 text-sm">
      <Row label={bank("depositsTotal")} value={formatAmount(depositsTotal)} />
      <Row label={bank("carryover")} value={formatAmount(data.carryover)} />
      <Row
        label={bank("difference")}
        value={formatAmount(difference)}
        className={Math.round(difference) !== 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}
        strong
      />

      <div className="border-t border-border/60 pt-2">
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("reportPages.depositCount", { count: data.deposits.length })}</p>
        {data.deposits.length === 0 && <p className="py-1 text-xs text-muted-foreground">{bank("empty")}</p>}
        <ul className="divide-y divide-border/60">
          {[...data.deposits].sort((left, right) => left.date.localeCompare(right.date)).map(deposit => (
            <li key={deposit.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">{day(deposit.date)}</span>
              <span className="font-medium tabular-nums">{formatAmount(deposit.amount)}</span>
              {data.canEdit && (confirmRemove === deposit.id
                ? <span className="flex gap-1">
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={saving} onClick={() => void removeDeposit(deposit.id)}>{t("reportPages.remove")}</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={() => setConfirmRemove(null)}>{bank("cancel")}</Button>
                </span>
                : <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("reportPages.removeDeposit", { date: day(deposit.date), amount: formatAmount(deposit.amount) })} disabled={saving} onClick={() => setConfirmRemove(deposit.id)}>
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>)}
            </li>
          ))}
        </ul>
      </div>

      {data.canEdit && (adding
        ? <form className="space-y-2 rounded-xl border p-3" onSubmit={event => { event.preventDefault(); void addDeposit(); }}>
          <p className="text-xs text-muted-foreground">{bank("reportingMonth", { month })}</p>
          <label className="block space-y-1 text-xs">
            <span className="font-medium">{bank("depositDate")}</span>
            <Input type="date" min="2000-01-01" max="9999-12-31" required value={date} disabled={saving} onChange={event => setDate(event.target.value)} className="h-10" />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium">{bank("depositAmount")}</span>
            <Input type="number" inputMode="decimal" min="0" max="1000000000" step="any" required value={amount} disabled={saving} onChange={event => setAmount(event.target.value)} className="h-10 text-right" placeholder="0" />
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" disabled={saving} onClick={() => { setAdding(false); setError(null); }}>{bank("cancel")}</Button>
            <Button type="submit" className="flex-1" disabled={saving || !formValid}>
              {saving ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="mr-1.5 h-4 w-4" />}{bank("save")}
            </Button>
          </div>
        </form>
        : <Button variant="outline" className="w-full" disabled={saving} onClick={() => { setAdding(true); setError(null); }}>
          <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />{bank("addDeposit")}
        </Button>)}
      {error && <p role="alert" className="text-xs text-destructive">{bank(error)}</p>}
    </Card>
  );
}

function Row({ label, value, className, strong }: { label: string; value: string; className?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold", className)}>{value}</span>
    </div>
  );
}

function NotesReport({ shopId, month }: { shopId: string; month: string }) {
  const notes = useTranslations("MonthlyCell");
  const manager = useTranslations("Manager");
  const day = useDayFormat();
  const query = useQuery({ queryKey: monthlyCellQueryKey(shopId, month), queryFn: () => fetchMonthlyCellSummary(shopId, month), staleTime: 0 });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const rows = [...query.data.rows].reverse();
  return (
    <>
      <StatGrid items={[
        { label: notes("monthlyTotal"), value: `${formatAmount(query.data.totalAmount)} Lek` },
        { label: manager("reportPages.days"), value: String(query.data.rows.length) },
      ]} />
      <Section title={notes("title")}>
        {rows.length === 0 ? <EmptyState>{notes("empty")}</EmptyState> : (
          <Card className="divide-y divide-border/60 p-0">
            {rows.map(row => (
              <div key={row.date} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{day(row.date)}</span>
                  <span className="font-semibold tabular-nums">{formatAmount(row.amount)}</span>
                </div>
                <p className={cn("mt-1 text-sm", row.note ? "" : "text-muted-foreground")}>{row.note || "—"}</p>
                <div className="mt-1"><DailyReportLink shopId={shopId} date={row.date} /></div>
              </div>
            ))}
          </Card>
        )}
      </Section>
    </>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-10 rounded-xl pl-9" />
    </div>
  );
}

function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  const t = useTranslations("Manager");
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />{t("reportPages.previous")}</Button>
      <span className="text-xs text-muted-foreground">{t("reportPages.page", { page: page + 1, total: pageCount })}</span>
      <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => onChange(page + 1)}>{t("reportPages.next")}<ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" /></Button>
    </div>
  );
}

function DebtsReport({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("MonthlyDebts");
  const day = useDayFormat();
  const locale = useLocale();
  const { actor } = useShop();
  const canEdit = actor.role !== "viewer";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<"all" | "unpaid" | "paid">("unpaid");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: [...monthlyDebtsQueryKey(shopId, month), search, status, page],
    queryFn: async () => {
      const result = await fetchMonthlyDebts(shopId, { month, search, status, pageIndex: page, pageSize: 20 });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: async (row: MonthlyDebtRow) => {
      const result = await handleUpdateDebt({ shopId, date: row.date, debtId: row.debtId, expectedUpdatedAt: row.updatedAt, change: { kind: "payment", paid: !row.paidAt } });
      if (!result.success) throw new Error(t(result.error));
    },
    onSuccess: () => toast({ title: t("updated") }),
    onError: (error: Error) => toast({ variant: "destructive", title: t("updateFailed"), description: error.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: monthlyDebtsQueryKey(shopId, month) }),
  });

  return (
    <>
      {query.data && (
        <StatGrid items={[
          { label: t("unpaidTotal"), value: `${formatAmount(query.data.unpaidAmount)} Lek`, tone: query.data.unpaidAmount > 0 ? "bad" : "good" },
          { label: t("total"), value: `${formatAmount(query.data.totalAmount)} Lek` },
        ]} />
      )}
      <div className="mt-3 space-y-2">
        <SegmentedControl
          label={t("filterStatus")}
          value={status}
          onChange={value => { setStatus(value); setPage(0); }}
          options={[{ value: "unpaid", label: t("unpaid") }, { value: "paid", label: t("paid") }, { value: "all", label: t("all") }]}
        />
        <SearchBox value={search} onChange={value => { setSearch(value); setPage(0); }} placeholder={t("search")} />
      </div>
      <div className="mt-3">
        {query.isPending ? <LoadingState />
          : query.isError ? <ErrorState onRetry={() => void query.refetch()} />
            : query.data.rows.length === 0 ? <EmptyState>{t("empty")}</EmptyState>
              : <>
                <Card className="divide-y divide-border/60 p-0">
                  {query.data.rows.map(row => (
                    <div key={row.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-sm font-medium">{row.description}</p>
                        <span className="text-sm font-semibold tabular-nums">{formatAmount(row.amount)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                        <span>{day(row.date)}</span>
                        <span className={cn("rounded-full px-2 py-0.5 font-medium", row.paidAt ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
                          {row.paidAt ? `${t("paid")} · ${new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(row.paidAt))}` : t("unpaid")}
                        </span>
                        <DailyReportLink shopId={shopId} date={row.date} />
                      </div>
                      {canEdit && (
                        <Button variant="outline" size="sm" className="mt-2 h-8 w-full" disabled={mutation.isPending} onClick={() => mutation.mutate(row)}>
                          {row.paidAt ? <RotateCcw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> : <CheckCircle2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />}
                          {t(row.paidAt ? "markUnpaid" : "markPaid")}
                        </Button>
                      )}
                    </div>
                  ))}
                </Card>
                <Pager page={page} pageCount={Math.ceil(query.data.rowCount / 20)} onChange={setPage} />
              </>}
      </div>
    </>
  );
}

function UnsubscribesReport({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("MonthlyUnsubscribes");
  const day = useDayFormat();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: [...monthlyUnsubscribesQueryKey(shopId, month), search, page],
    queryFn: async () => {
      const result = await fetchMonthlyUnsubscribes(shopId, { month, search, pageIndex: page, pageSize: 20 });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
  return (
    <>
      {query.data && (
        <StatGrid items={[
          { label: t("total"), value: `${formatAmount(query.data.totalAmount)} Lek` },
          { label: t("count"), value: String(query.data.totalCount) },
        ]} />
      )}
      <div className="mt-3"><SearchBox value={search} onChange={value => { setSearch(value); setPage(0); }} placeholder={t("search")} /></div>
      <div className="mt-3">
        {query.isPending ? <LoadingState />
          : query.isError ? <ErrorState onRetry={() => void query.refetch()} />
            : query.data.rows.length === 0 ? <EmptyState>{t("empty")}</EmptyState>
              : <>
                <Card className="divide-y divide-border/60 p-0">
                  {query.data.rows.map(row => (
                    <div key={row.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{row.msisdn || "—"}</span>
                        <span className="font-semibold tabular-nums">{formatAmount(row.amount)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{day(row.date)}</span>
                        <span>{t("invoice")}: {row.invoice || "—"}</span>
                        <DailyReportLink shopId={shopId} date={row.date} />
                      </div>
                    </div>
                  ))}
                </Card>
                <Pager page={page} pageCount={Math.ceil(query.data.rowCount / 20)} onChange={setPage} />
              </>}
      </div>
    </>
  );
}

const WORKING_CODES = new Set(["1", "2", "1+2"]);

function ShiftsReport({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("Manager");
  const attendance = useTranslations("Attendance");
  const locale = useLocale();
  const today = todayInTirana();
  const dates = monthDates(month);
  const [selected, setSelected] = useState(() => dates.includes(today) ? today : dates[0]);
  const activeDate = dates.includes(selected) ? selected : dates[0];
  const query = useQuery({ queryKey: attendanceQueryKey(shopId, month), queryFn: () => fetchAttendanceMonth(shopId, month) });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const day = useDayFormat();
  const { actor } = useShop();
  const canEdit = actor.role !== "viewer";
  const { toast } = useToast();
  const saveDay = useSaveAttendanceDay(shopId, month);
  const [editing, setEditing] = useState<AttendanceStaff | null>(null);
  const [copying, setCopying] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const loaded = Boolean(query.data);
  // Keep the selected day in view in the horizontal day strip.
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (strip && chip) strip.scrollLeft = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
  }, [activeDate, loaded]);

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const staff = query.data.config?.staff ?? [];
  if (!staff.length) return <EmptyState>{t("reports.noRoster")}</EmptyState>;
  const byDate = new Map(query.data.days.map(day => [day.date, new Map(day.entries.map(entry => [entry.staffId, entry]))]));
  const entries = byDate.get(activeDate) ?? new Map<string, AttendanceEntry>();
  const codeLabel = (entry?: AttendanceEntry) => !entry ? t("reportPages.notEntered")
    : entry.code === "OTHER" ? entry.note : `${attendance(`codes.${entry.code}`)}${entry.note ? ` · ${entry.note}` : ""}`;
  const copyable = canEdit && entries.size === 0 ? previousDayEntries(query.data, activeDate) : null;
  const copyPreviousDay = async () => {
    if (!copyable || copying) return;
    setCopying(true);
    try {
      const result = await saveDay(query.data, activeDate, copyable);
      toast(result.success ? { title: attendance("saved") } : { variant: "destructive", title: t(`entry.errors.${result.error === "conflict" ? "conflict" : "saveFailed"}`) });
    } catch {
      toast({ variant: "destructive", title: t("entry.errors.saveFailed") });
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <div ref={stripRef} className="relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("reportPages.chooseDay")}>
        {dates.map(date => {
          const dayEntries = byDate.get(date);
          const working = dayEntries ? [...dayEntries.values()].filter(entry => WORKING_CODES.has(entry.code)).length : null;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={date === activeDate}
              onClick={() => setSelected(date)}
              className={cn("flex w-11 shrink-0 flex-col items-center rounded-xl border py-1.5 text-xs", date === activeDate ? "border-primary bg-primary/10 text-primary" : "border-border", date === today && date !== activeDate && "border-primary/50")}
            >
              <span className="text-[10px] text-muted-foreground">{weekday.format(new Date(`${date}T00:00:00Z`))}</span>
              <span className="font-semibold tabular-nums">{Number(date.slice(8))}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{working ?? "·"}</span>
            </button>
          );
        })}
      </div>
      <Section title={t("reportPages.whoIsWorking")} aside={t("reports.attendanceDone", { present: [...entries.values()].filter(entry => WORKING_CODES.has(entry.code)).length, total: staff.length })}>
        {canEdit && <p className="mb-2 text-xs text-muted-foreground">{t("entry.tapToSet")}</p>}
        {copyable && (
          <Button variant="outline" className="mb-2 w-full" disabled={copying} onClick={() => void copyPreviousDay()}>
            {copying ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Copy aria-hidden="true" className="mr-1.5 h-4 w-4" />}{t("entry.copyPreviousDay")}
          </Button>
        )}
        <Card className="divide-y divide-border/60 p-0">
          {staff.map(person => {
            const entry = entries.get(person.id);
            const working = entry && WORKING_CODES.has(entry.code);
            const workedDays = query.data.days.filter(item => item.entries.some(value => value.staffId === person.id && WORKING_CODES.has(value.code))).length;
            const RowTag = canEdit ? "button" : "div";
            return (
              <RowTag
                key={person.id}
                {...(canEdit ? { type: "button" as const, onClick: () => setEditing(person), "aria-label": attendance("chooseFor", { name: person.name, date: day(activeDate) }) } : {})}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-foreground/[0.04]"
              >
                <Initials name={person.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{person.role} · {t("reportPages.daysWorked", { count: workedDays })}</span>
                </span>
                <span className={cn("max-w-[45%] truncate rounded-full px-2 py-0.5 text-[11px] font-medium", !entry ? "text-muted-foreground" : working ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-foreground/[0.06]")}>
                  {codeLabel(entry)}
                </span>
                {canEdit && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </RowTag>
            );
          })}
        </Card>
      </Section>
      <AttendanceEntrySheet shopId={shopId} month={month} date={activeDate} dateLabel={day(activeDate)} person={editing} data={query.data} onClose={() => setEditing(null)} />
    </>
  );
}

type StatusFilter = NonNullable<ProcedureFilter["status"]> | "all";

function ProceduresReport({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("Procedures");
  const manager = useTranslations("Manager");
  const locale = useLocale();
  const [status, setStatus] = useState<StatusFilter>("all");
  const filter: ProcedureFilter = status === "all" ? {} : { status };
  const { actor } = useShop();
  const canEdit = actor.role !== "viewer";
  const searchParams = useSearchParams();
  // `?add=1` (from Today and Menu) opens the add form straight away.
  const [sheet, setSheet] = useState<ProcedureSheetState>(() => canEdit && searchParams.get("add") === "1" ? { mode: "add" } : null);
  const query = useInfiniteQuery({
    queryKey: [...proceduresQueryKey(shopId, month), "manager-list", status],
    queryFn: ({ pageParam }) => fetchProcedures(shopId, month, pageParam, filter),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const dateTime = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const summary = query.data.pages[0]?.summary;
  const items = query.data.pages.flatMap(page => page.items);

  return (
    <>
      {summary && (
        <StatGrid items={[
          { label: t("total"), value: String(summary.total) },
          { label: t("completed"), value: String(summary.completed), tone: "good" },
          { label: t("pending"), value: String(summary.pending) },
          { label: t("negative"), value: String(summary.negative), tone: summary.negative > 0 ? "bad" : undefined },
        ]} />
      )}
      {canEdit && (
        <Button className="mt-3 w-full" onClick={() => setSheet({ mode: "add" })}>
          <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />{t("add")}
        </Button>
      )}
      <div className="mt-3">
        <SegmentedControl
          label={t("status")}
          value={status}
          onChange={setStatus}
          options={[{ value: "all", label: manager("reportPages.all") }, { value: "completed", label: t("completed") }, { value: "pending", label: t("pending") }, { value: "negative", label: t("negative") }]}
        />
      </div>
      <div className="mt-3">
        {items.length === 0 ? <EmptyState>{status === "all" ? t("empty") : t("emptyFiltered")}</EmptyState> : (
          <>
            <Card className="divide-y divide-border/60 p-0">
              {items.map(item => (
                <button key={item.id} type="button" disabled={!canEdit} onClick={() => setSheet({ mode: "edit", record: item })} className="block w-full px-4 py-3 text-left active:bg-foreground/[0.04] disabled:opacity-100">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</p>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      item.status === "completed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : item.status === "pending" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-400")}>
                      {t(item.status)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {item.product} · {item.user} · {dateTime.format(new Date(item.dateTime))}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{t("orderNumber")}: {item.orderNumber} · {t("customerId")}: {item.customerId}</p>
                </button>
              ))}
            </Card>
            {query.hasNextPage && (
              <Button variant="outline" className="mt-3 w-full" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {query.isFetchingNextPage ? manager("loading") : manager("reportPages.loadMore")}
              </Button>
            )}
          </>
        )}
      </div>
      <ProcedureSheet shopId={shopId} month={month} state={sheet} onClose={() => setSheet(null)} />
    </>
  );
}

function ActivityReport({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("DailyActivity");
  const manager = useTranslations("Manager");
  const query = useQuery({ queryKey: dailyActivityMonthQueryKey(shopId, month), queryFn: () => fetchDailyActivityMonth(shopId, month), staleTime: 15_000 });

  const calculation = useMemo(() => {
    const data = query.data;
    if (!data?.settings) return null;
    try {
      const impact = getDailyActivityProcedureImpact(data.actuals, data.procedures);
      return {
        confirmed: calculateDailyActivity(impact.actuals, data.settings),
        withPending: calculateDailyActivity(impact.includingPendingActuals, data.settings).total,
        settings: data.settings,
      };
    } catch {
      return null;
    }
  }, [query.data]);

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const today = todayInTirana();
  const recorded = new Set(query.data.days.map(day => day.date));
  const missing = monthDates(month).filter(date => date <= today && !recorded.has(date)).length;
  const drafts = query.data.days.filter(day => day.status === "draft").length;
  const label = (metric: PerformanceMetric) => metricShortLabel({
    id: metric,
    label: metric.startsWith("custom_") ? getCustomMetricLabel(metric, calculation?.settings.metricSettings) : null,
  });

  return (
    <>
      <StatGrid items={[
        { label: t("confirmedPerformance"), value: calculation ? `${Math.round(calculation.confirmed.total)}%` : "—" },
        { label: t("includingPendingPerformance"), value: calculation ? `${Math.round(calculation.withPending)}%` : "—" },
        { label: t("recordedDays"), value: String(query.data.days.length) },
        { label: t("draft"), value: String(drafts), tone: drafts > 0 ? "bad" : undefined },
      ]} />
      {missing > 0 && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{t("missingDays", { count: missing })}</p>}
      <Section title={t("activity")}>
        {!calculation ? <EmptyState>{manager("reportPages.activityNotSetUp")}</EmptyState> : (
          <Card className="divide-y divide-border/60 p-0">
            {calculation.confirmed.rows.map(row => (
              <div key={row.metric} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{label(row.metric)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatAmount(row.actual)} / {formatAmount(row.target)}</span>
                  <Percent value={row.achievement} className="w-11 text-right text-xs" />
                </div>
                <ProgressBar value={row.achievement} className="mt-1.5" />
              </div>
            ))}
          </Card>
        )}
      </Section>
    </>
  );
}
