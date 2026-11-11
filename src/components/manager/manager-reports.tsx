import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarRange, CheckCircle2, ChevronRight, Circle, ClipboardCheck, KeyRound, ListChecks, type LucideIcon, UserMinus, Wallet, CalendarDays, NotebookPen } from "lucide-react";
import { useTranslations } from "use-intl";

import { useManager } from "@/components/manager/manager-provider";
import { EmptyState, Section, formatCompact } from "@/components/manager/manager-ui";
import { RestrictedAccessDialog } from "@/components/restricted-access";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { fetchAttendanceMonth } from "@/server/actions/attendance";
import { fetchDailyClosing, fetchMonthlyClosingSummary } from "@/server/actions/daily-closing";
import { fetchProcedures } from "@/server/actions/procedures";
import { attendanceQueryKey, hasCompleteAttendance } from "@/lib/attendance";
import { managerBasePath, todayInTirana } from "@/lib/manager-mode";
import { monthlyClosingQueryKey } from "@/lib/monthly-closing";
import Link from "@/lib/navigation";
import { proceduresQueryKey } from "@/lib/procedures";
import { cn } from "@/lib/utils";

const PRESENT_CODES = new Set(["1", "2", "1+2"]);

export function ManagerReports() {
  const t = useTranslations("Manager");
  const { shop, locale } = useManager();
  const access = useRestrictedAccess();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const today = todayInTirana();
  const month = today.slice(0, 7);
  const shopId = shop?.id ?? "";

  const closingQuery = useQuery({
    queryKey: ["manager", "daily-closing", shopId, today],
    queryFn: () => fetchDailyClosing(shopId, today),
    enabled: Boolean(shop),
    staleTime: 0,
  });
  const attendanceQuery = useQuery({
    queryKey: attendanceQueryKey(shopId, month),
    queryFn: () => fetchAttendanceMonth(shopId, month),
    enabled: Boolean(shop),
  });
  const proceduresQuery = useQuery({
    queryKey: [...proceduresQueryKey(shopId, month), "manager-summary"],
    queryFn: () => fetchProcedures(shopId, month),
    enabled: Boolean(shop),
    staleTime: 30_000,
  });
  const summaryQuery = useQuery({
    queryKey: monthlyClosingQueryKey(shopId, month),
    queryFn: () => fetchMonthlyClosingSummary(shopId, month),
    enabled: Boolean(shop) && access.data === true,
  });

  if (!shop) return <EmptyState>{t("noShop")}</EmptyState>;

  const base = `/${locale}/shop/${shop.id}`;
  const reportBase = `${managerBasePath(locale)}/reports`;
  const closingPath = `${base}/closing`;
  const unlocked = access.data === true;

  const closing = closingQuery.data;
  const closingDone = closing?.status === "finalized";
  const closingDetail = closingQuery.isPending ? "…" : closingQuery.isError ? t("reports.unavailable")
    : !closing ? t("reports.closingMissing") : closingDone ? t("reports.closingFinal") : t("reports.closingDraft");

  const attendance = attendanceQuery.data;
  const staff = attendance?.config?.staff ?? [];
  const todayEntries = attendance?.days.find(day => day.date === today)?.entries ?? [];
  const attendanceDone = hasCompleteAttendance(staff, todayEntries);
  const present = todayEntries.filter(entry => PRESENT_CODES.has(entry.code)).length;
  const attendanceDetail = attendanceQuery.isPending ? "…" : attendanceQuery.isError ? t("reports.unavailable")
    : !staff.length ? t("reports.noRoster") : attendanceDone ? t("reports.attendanceDone", { present, total: staff.length }) : t("reports.attendanceMissing");

  const procedures = proceduresQuery.data?.summary;
  const proceduresDetail = proceduresQuery.isPending ? "…" : proceduresQuery.isError ? t("reports.unavailable")
    : t("reports.proceduresMonth", { count: procedures?.total ?? 0 });

  const doneCount = [closingDone, attendanceDone].filter(Boolean).length;

  const netRows = summaryQuery.data?.rows ?? [];
  const lockedTile = !unlocked ? () => setUnlockOpen(true) : undefined;

  return (
    <>
      <Section title={t("reports.today")} aside={t("reports.doneCount", { done: doneCount, total: 2 })} className="mt-0">
        <div className="space-y-2">
          <TodayItem href={closingPath} icon={ClipboardCheck} title={t("reports.dailyClosing")} detail={closingDetail} done={closingDone} action={closingDone ? undefined : t("reports.enter")} />
          <TodayItem href={`${reportBase}/shifts`} icon={CalendarRange} title={t("reports.attendance")} detail={attendanceDetail} done={attendanceDone} action={attendanceDone ? undefined : t("reports.enter")} />
          <TodayItem href={`${reportBase}/procedures?add=1`} icon={ListChecks} title={t("reports.procedures")} detail={proceduresDetail} action={t("reports.add")} />
        </div>
      </Section>

      <Section title={t("reports.reports")} aside={!unlocked && !access.isPending ? t("reports.someLocked") : undefined}>
        <div className="grid grid-cols-2 gap-2">
          <ReportTile
            className="col-span-2"
            href={`${reportBase}/summary`}
            onLocked={lockedTile}
            icon={Wallet}
            title={t("reports.monthlySummary")}
          >
            {unlocked && summaryQuery.data
              ? <>
                <p className="text-xl font-semibold tabular-nums">{formatCompact(summaryQuery.data.totals.net)} <span className="text-xs font-normal text-muted-foreground">ALL</span></p>
                <Sparkline values={netRows.map(row => row.net)} />
                <p className="text-xs text-muted-foreground">{t("reports.closingsThisMonth", { count: netRows.length })}</p>
              </>
              : <p className="text-xs text-muted-foreground">{t("reports.monthlySummaryHint")}</p>}
          </ReportTile>
          <ReportTile href={`${reportBase}/debts`} onLocked={lockedTile} icon={Wallet} title={t("reports.debts")}>
            <p className="text-xs text-muted-foreground">{t("reports.debtsHint")}</p>
          </ReportTile>
          <ReportTile href={`${reportBase}/notes`} onLocked={lockedTile} icon={NotebookPen} title={t("reports.notes")}>
            <p className="text-xs text-muted-foreground">{t("reports.notesHint")}</p>
          </ReportTile>
          <ReportTile href={`${reportBase}/shifts`} icon={CalendarDays} title={t("reports.shifts")}>
            {staff.length
              ? <p className="text-xl font-semibold tabular-nums">{present}<span className="text-xs font-normal text-muted-foreground"> / {staff.length} {t("reports.presentToday")}</span></p>
              : <p className="text-xs text-muted-foreground">{t("reports.shiftsHint")}</p>}
          </ReportTile>
          <ReportTile href={`${reportBase}/procedures`} icon={ListChecks} title={t("reports.procedures")}>
            {procedures && procedures.total > 0
              ? <>
                <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <span className="bg-emerald-500" style={{ width: `${(procedures.completed / procedures.total) * 100}%` }} />
                  <span className="bg-amber-500" style={{ width: `${(procedures.pending / procedures.total) * 100}%` }} />
                  <span className="bg-rose-500" style={{ width: `${(procedures.negative / procedures.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("reports.procedureSplit", { completed: procedures.completed, pending: procedures.pending, negative: procedures.negative })}</p>
              </>
              : <p className="text-xs text-muted-foreground">{t("reports.proceduresHint")}</p>}
          </ReportTile>
          <ReportTile href={`${reportBase}/unsubscribes`} onLocked={lockedTile} icon={UserMinus} title={t("reports.unsubscribes")}>
            <p className="text-xs text-muted-foreground">{t("reports.unsubscribesHint")}</p>
          </ReportTile>
          <ReportTile href={`${reportBase}/activity`} icon={Activity} title={t("reports.dailyActivity")}>
            <p className="text-xs text-muted-foreground">{t("reports.dailyActivityHint")}</p>
          </ReportTile>
        </div>
      </Section>
      <RestrictedAccessDialog open={unlockOpen} onOpenChange={setUnlockOpen} onGranted={() => setUnlockOpen(false)} />
    </>
  );
}

function TodayItem({ href, icon: Icon, title, detail, done, action }: { href: string; icon: LucideIcon; title: string; detail: string; done?: boolean; action?: string }) {
  return (
    <Link href={href} className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5 active:scale-[0.99]">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-primary/10 text-primary")}>
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {done
        ? <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : action
          ? <span className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium">{action}</span>
          : <Circle aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground/50" />}
    </Link>
  );
}

function ReportTile({ href, icon: Icon, title, children, onLocked, className }: { href: string; icon: LucideIcon; title: string; children: ReactNode; onLocked?: () => void; className?: string }) {
  const t = useTranslations("Manager");
  const header = (
    <span className="flex items-center gap-2">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      {onLocked ? <KeyRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </span>
  );
  const classes = cn("glass block min-w-0 rounded-2xl p-3 text-left active:scale-[0.99]", className);
  if (onLocked) {
    return <button type="button" onClick={onLocked} className={classes}>{header}<span className="mt-1.5 block text-xs text-muted-foreground">{t("reports.lockedHint")}</span></button>;
  }
  return <Link href={href} className={classes}>{header}<div className="mt-1.5">{children}</div></Link>;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  let total = 0;
  const cumulative = values.map(value => (total += value));
  const min = Math.min(0, ...cumulative);
  const max = Math.max(...cumulative, 1);
  const points = cumulative.map((value, index) => `${(index / (cumulative.length - 1)) * 100},${36 - ((value - min) / (max - min || 1)) * 32}`).join(" ");
  return (
    <svg viewBox="0 0 100 38" preserveAspectRatio="none" className="my-1 h-10 w-full text-primary" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

