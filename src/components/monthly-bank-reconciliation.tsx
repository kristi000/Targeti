"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";

import { fetchMonthlyBankReconciliation, saveMonthlyBankReconciliation } from "@/app/actions/monthly-bank";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { useToast } from "@/hooks/use-toast";
import { monthlyBankQueryKey, saveMonthlyBankReconciliationSchema, type MonthlyBankReconciliation as BankReconciliation } from "@/lib/monthly-bank";
import { navigationGuardEvent } from "@/lib/navigation-guard";
import { cn } from "@/lib/utils";

type BankDraft = {
  expectedRevision: number;
  deposits: { id: string; date: string; amount: string }[];
  carryover: string;
  carryoverNote: string;
};
type SaveError = "conflict" | "invalidData" | "sessionExpired" | "accessDenied" | "saveFailed";
type Props = {
  shopId: string;
  month: string;
  totals?: { boss: number; invoice: number };
  onDirtyChange?: (dirty: boolean) => void;
};

function createDraft(data: BankReconciliation): BankDraft {
  return {
    expectedRevision: data.revision,
    deposits: data.deposits.map(deposit => ({ ...deposit, amount: String(deposit.amount) })),
    carryover: String(data.carryover),
    carryoverNote: data.carryoverNote,
  };
}

export function MonthlyBankReconciliation(props: Props) {
  const t = useTranslations("MonthlyBank");
  const query = useQuery({
    queryKey: monthlyBankQueryKey(props.shopId, props.month),
    queryFn: () => fetchMonthlyBankReconciliation(props.shopId, props.month),
    staleTime: 15_000,
  });

  if (!query.data) return <div className="rounded-md border p-4 text-sm" role={query.isError ? "alert" : "status"}>
    {t(query.isError ? "loadFailed" : "loading")}
    {query.isError && <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => void query.refetch()}>{t("retry")}</Button>}
  </div>;

  return <BankEditor key={`${props.shopId}:${props.month}`} {...props} data={query.data} />;
}

function BankEditor({ shopId, month, totals, onDirtyChange, data }: Props & { data: BankReconciliation & { canEdit: boolean } }) {
  const t = useTranslations("MonthlyBank");
  const locale = useLocale();
  const client = useQueryClient();
  const { toast } = useToast();
  const draftKey = ["monthly-bank-draft", shopId, month] as const;
  const [draft, setDraftState] = useState<BankDraft | null>(() => client.getQueryData<BankDraft>(draftKey) ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const dirty = draft !== null || saving;
  const canEdit = data.canEdit;
  const current = draft ?? createDraft(data);
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const hasNumbers = current.carryover.trim() !== "" && current.deposits.every(deposit => deposit.amount.trim() !== "");
  const input = {
    shopId,
    month,
    expectedRevision: current.expectedRevision,
    deposits: current.deposits.map(deposit => ({ ...deposit, amount: Number(deposit.amount) })),
    carryover: Number(current.carryover),
    carryoverNote: current.carryoverNote,
  };
  const valid = hasNumbers && saveMonthlyBankReconciliationSchema.safeParse(input).success;
  const revisionChanged = Boolean(draft && draft.expectedRevision !== data.revision);
  const depositsTotal = input.deposits.reduce((sum, deposit) => sum + deposit.amount, 0);
  const reconciliation = totals && valid ? depositsTotal + input.carryover - totals.boss - totals.invoice : null;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => client.getQueryCache().subscribe(event => {
    const key = event.query.queryKey;
    if (key.length === 3 && key[0] === "monthly-bank-draft" && key[1] === shopId && key[2] === month) {
      setDraftState(client.getQueryData<BankDraft>(key) ?? null);
    }
  }), [client, shopId, month]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const beforeClientNavigation = (event: Event) => {
      event.preventDefault();
      toast({ title: t("unsaved") });
    };
    const beforeNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.download || anchor.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      toast({ title: t("unsaved") });
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(navigationGuardEvent, beforeClientNavigation);
    document.addEventListener("click", beforeNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(navigationGuardEvent, beforeClientNavigation);
      document.removeEventListener("click", beforeNavigation, true);
    };
  }, [dirty, t, toast]);

  // Keep unsaved values in this account's memory cache when browser history or a
  // programmatic shop change unmounts the editor. They never reach browser storage.
  const setDraft = (next: BankDraft | null) => {
    if (next) {
      client.setQueryDefaults(draftKey, { gcTime: Infinity });
      client.setQueryData(draftKey, next);
    } else {
      client.removeQueries({ queryKey: draftKey, exact: true });
    }
    setDraftState(next);
  };
  const updateDraft = (update: (previous: BankDraft) => BankDraft) => {
    setDraft(update(draft ?? createDraft(data)));
    setError(null);
  };
  const save = async () => {
    if (!draft || !valid || !canEdit || saving || revisionChanged) return;
    const submittedDraft = client.getQueryData<BankDraft>(draftKey);
    setSaving(true);
    setError(null);
    try {
      const result = await saveMonthlyBankReconciliation(input);
      if (!result.success) {
        const code = result.error;
        setError(code === "conflict" || code === "invalidData" || code === "sessionExpired" || code === "accessDenied" ? code : "saveFailed");
        if (result.error === "conflict") void client.invalidateQueries({ queryKey: monthlyBankQueryKey(shopId, month) });
        return;
      }
      await client.cancelQueries({ queryKey: monthlyBankQueryKey(shopId, month), exact: true });
      client.setQueryData<BankReconciliation & { canEdit: boolean }>(monthlyBankQueryKey(shopId, month), previous =>
        previous && previous.revision > result.data.revision ? previous : result.data);
      // A remounted editor may already have cached more changes while this save ran.
      if (client.getQueryData<BankDraft>(draftKey) === submittedDraft) setDraft(null);
      toast({ title: t("saved") });
    } catch {
      setError("saveFailed");
    } finally {
      setSaving(false);
    }
  };

  return <section className="space-y-2 rounded-md border p-3" aria-label={t("title")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      {(canEdit || draft) && <div className="flex flex-wrap gap-1.5">
        {canEdit && <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={saving || current.deposits.length >= 366} onClick={() => updateDraft(previous => ({ ...previous, deposits: [...previous.deposits, { id: crypto.randomUUID(), date: `${month}-01`, amount: "" }] }))}><Plus className="mr-1 h-3.5 w-3.5" />{t("addDeposit")}</Button>}
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!draft || saving} onClick={() => { setDraft(null); setError(null); void client.invalidateQueries({ queryKey: monthlyBankQueryKey(shopId, month) }); }}><X className="mr-1 h-3.5 w-3.5" />{t("cancel")}</Button>
        {canEdit && <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={!draft || saving || !valid || revisionChanged} onClick={() => void save()}>{saving ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}{t("save")}</Button>}
      </div>}
    </div>
    <p className="text-xs text-muted-foreground">{t("reportingMonth", { month })}</p>
    <SpreadsheetTable aria-label={t("deposits")} className="min-w-[340px] [&_td]:p-0">
      <thead><tr><th scope="col" className="w-9 text-center">#</th><th scope="col" className="text-left">{t("depositDate")}</th><th scope="col" className="text-right">{t("depositAmount")}</th>{canEdit && <th scope="col" className="w-8"><span className="sr-only">{t("actions")}</span></th>}</tr></thead>
      <tbody>{current.deposits.map((deposit, index) => <tr key={deposit.id}>
        <td className="text-center text-muted-foreground">{index + 1}</td>
        <td>{canEdit ? <Input type="date" min="2000-01-01" max="9999-12-31" aria-label={t("dateForRow", { number: index + 1 })} className="h-7 min-w-36 rounded-none border-0 px-2 text-xs shadow-none" value={deposit.date} disabled={saving} onChange={event => updateDraft(previous => ({ ...previous, deposits: previous.deposits.map(row => row.id === deposit.id ? { ...row, date: event.target.value } : row) }))} /> : <span className="block px-2 py-1">{deposit.date}</span>}</td>
        <td>{canEdit ? <Input type="number" min="0" max="1000000000" step="any" aria-label={t("amountForRow", { number: index + 1 })} className="h-7 w-36 rounded-none border-0 px-2 text-right text-xs shadow-none" value={deposit.amount} disabled={saving} onChange={event => updateDraft(previous => ({ ...previous, deposits: previous.deposits.map(row => row.id === deposit.id ? { ...row, amount: event.target.value } : row) }))} /> : <span className="block px-2 py-1 text-right">{formatter.format(Number(deposit.amount))}</span>}</td>
        {canEdit && <td><Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={t("removeDeposit", { number: index + 1 })} disabled={saving} onClick={() => updateDraft(previous => ({ ...previous, deposits: previous.deposits.filter(row => row.id !== deposit.id) }))}><Trash2 className="h-3.5 w-3.5" /></Button></td>}
      </tr>)}
        {!current.deposits.length && <tr><td colSpan={canEdit ? 4 : 3}><p className="px-3 py-2 text-center text-muted-foreground">{t("empty")}</p></td></tr>}
      </tbody>
      <tfoot><tr><td colSpan={2}><span className="block px-2 py-1">{t("depositsTotal")}</span></td><td className="text-right"><span className="block px-2 py-1">{Number.isFinite(depositsTotal) ? formatter.format(depositsTotal) : "—"}</span></td>{canEdit && <td />}</tr></tfoot>
    </SpreadsheetTable>
    <div className="grid max-w-lg gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <label className="space-y-1 text-xs"><span className="block font-medium">{t("carryover")}</span>{canEdit ? <Input type="number" min="-1000000000" max="1000000000" step="any" className="h-8 text-right text-xs" value={current.carryover} disabled={saving} onChange={event => updateDraft(previous => ({ ...previous, carryover: event.target.value }))} /> : <span className="block rounded-md border px-3 py-2 text-right tabular-nums">{formatter.format(Number(current.carryover))}</span>}</label>
      <label className="space-y-1 text-xs"><span className="block font-medium">{t("carryoverNote")}</span>{canEdit ? <Input className="h-8 text-xs" value={current.carryoverNote} maxLength={500} disabled={saving} onChange={event => updateDraft(previous => ({ ...previous, carryoverNote: event.target.value }))} /> : <span className="block min-h-8 rounded-md border px-3 py-2">{current.carryoverNote || "—"}</span>}</label>
    </div>
    <p className="text-xs text-muted-foreground">{t("carryoverHelp")}</p>
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded border bg-muted/40 px-2 py-1.5 text-xs"><span>{t("difference")}</span><strong className={cn("tabular-nums", reconciliation !== null && reconciliation < 0 && "text-destructive")}>{reconciliation === null ? "—" : formatter.format(reconciliation)} Lek</strong></div>
    <p className="text-xs text-muted-foreground">{t("formula")}</p>
    <p className="text-xs text-muted-foreground">{t("workbookHelp")}</p>
    {dirty && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("unsaved")}</p>}
    {(error || revisionChanged) && <p role="alert" className="text-xs text-destructive">{t(revisionChanged ? "conflict" : error!)}</p>}
  </section>;
}
