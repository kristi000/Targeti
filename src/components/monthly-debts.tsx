"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw, Search, Pencil, CheckCircle2, RotateCcw, Save } from "lucide-react";
import { fetchMonthlyDebts, handleUpdateDebt } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { monthlyClosingQueryKey, monthlyDebtsQueryKey, type MonthlyDebtRow } from "@/lib/monthly-closing";
import { formatReportingMonth } from "@/lib/reporting-month";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { debtMutationSchema } from "@/lib/persistence-schemas";
import type { z } from "zod";

class DebtLoadError extends Error {
  constructor(readonly reason: "invalidData" | "invalidRequest" | "sessionExpired" | "loadFailed", readonly date?: string) {
    super(reason);
  }
}

export function MonthlyDebts({ shopId, month, onOpenReport, canEdit, onUpdated }: { shopId: string; month: string; onOpenReport: (date: string) => void; canEdit: boolean; onUpdated: () => void }) {
  const t = useTranslations("MonthlyDebts");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<"all" | "unpaid" | "paid">("all");
  const [editing, setEditing] = useState<MonthlyDebtRow | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: z.infer<typeof debtMutationSchema>) => {
      const result = await handleUpdateDebt(input);
      if (!result.success) throw new Error(t(result.error));
    },
    onSuccess: async () => {
      setEditing(null);
      onUpdated();
      toast({ title: t("updated") });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: monthlyDebtsQueryKey(shopId, month) }),
        queryClient.invalidateQueries({ queryKey: monthlyClosingQueryKey(shopId, month) }),
      ]);
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast({ variant: "destructive", title: t("updateFailed"), description: error.message });
      void queryClient.invalidateQueries({ queryKey: monthlyDebtsQueryKey(shopId, month) });
    },
  });
  const updateDebt = (row: MonthlyDebtRow, change: z.infer<typeof debtMutationSchema>["change"]) => {
    const parsed = debtMutationSchema.safeParse({ shopId, date: row.date, debtId: row.debtId, expectedUpdatedAt: row.updatedAt, change });
    if (!parsed.success) { setFormError(t("invalidEdit")); return; }
    setFormError(null);
    mutation.mutate(parsed.data);
  };
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 as const });
  const debts = useQuery({
    queryKey: [...monthlyDebtsQueryKey(shopId, month), search, status, pagination.pageIndex],
    queryFn: async () => {
      const result = await fetchMonthlyDebts(shopId, { month, search, status, ...pagination });
      if (!result.success) throw new DebtLoadError(result.error, result.date);
      return result.data;
    },
    retry: (attempt, error) => !(error instanceof DebtLoadError) && attempt < 1,
    staleTime: 0,
  });
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invalidReportDate = debts.error instanceof DebtLoadError ? debts.error.date : undefined;
  const money = (value: number) => `${formatter.format(value)} Lek`;
  const columns: ColumnDef<MonthlyDebtRow>[] = [
    { accessorKey: "date", header: t("date") },
    { accessorKey: "description", header: t("reference") },
    { accessorKey: "amount", header: `${t("amount")} (Lek)`, cell: ({ row }) => formatter.format(row.original.amount) },
    { id: "status", header: t("status"), cell: ({ row }) => <Badge variant={row.original.paidAt ? "secondary" : "outline"}>{t(row.original.paidAt ? "paid" : "unpaid")}</Badge> },
    { id: "paidAt", header: t("paidAt"), cell: ({ row }) => row.original.paidAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(row.original.paidAt)) : "—" },
    { id: "actions", header: t("actions"), cell: ({ row }) => canEdit ? <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => { setEditing(row.original); setDescription(row.original.description); setAmount(String(row.original.amount)); setFormError(null); }}><Pencil className="mr-1 h-3.5 w-3.5" />{t("edit")}</Button>
      <Button variant="outline" size="sm" disabled={mutation.isPending} onClick={() => updateDebt(row.original, { kind: "payment", paid: !row.original.paidAt })}>{row.original.paidAt ? <RotateCcw className="mr-1 h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}{t(row.original.paidAt ? "markUnpaid" : "markPaid")}</Button>
    </div> : null },
    { id: "report", header: t("report"), cell: ({ row }) => <Button variant="link" size="sm" className="h-5 px-0 text-xs text-emerald-800 dark:text-emerald-300" onClick={() => onOpenReport(row.original.date)}><ArrowUpRight className="mr-1 h-3 w-3" />{t("openReport")}</Button> },
  ];
  const table = useReactTable({
    data: debts.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel(),
    manualPagination: true, rowCount: debts.data?.rowCount ?? 0,
    state: { pagination },
    onPaginationChange: updater => setPagination(current => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return { pageIndex: next.pageIndex, pageSize: 20 };
    }),
    getRowId: row => row.id,
  });

  return <section className="space-y-2" aria-label={t("title")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{t("title")} · {formatReportingMonth(month, locale)}</h2><p className="text-xs text-muted-foreground">{t("description")}</p></div>
      <Button variant="outline" size="sm" disabled={debts.isFetching} onClick={() => void debts.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" />{t("refresh")}</Button>
    </div>
    <div className="border border-slate-300 bg-slate-50 p-1.5 dark:border-slate-600 dark:bg-slate-900"><div className="relative max-w-md"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="h-7 rounded-none pl-7 text-xs" aria-label={t("search")} placeholder={t("search")} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPagination({ pageIndex: 0, pageSize: 20 }); }} /></div></div>
    <div className="flex gap-2" role="group" aria-label={t("filterStatus")}>{(["all", "unpaid", "paid"] as const).map(value => <Button key={value} size="sm" variant={status === value ? "default" : "outline"} aria-pressed={status === value} onClick={() => { setStatus(value); setPagination({ pageIndex: 0, pageSize: 20 }); }}>{t(value)}</Button>)}</div>
    {debts.isPending ? <p role="status" className="p-8 text-center">{t("loading")}</p>
      : debts.isError ? <div role="alert" className="space-y-2 rounded-lg border border-destructive p-6 text-destructive">
        <p>{debts.error instanceof DebtLoadError ? t(debts.error.reason, { date: debts.error.date ?? "" }) : t("loadFailed")}</p>
        {invalidReportDate && <Button variant="outline" size="sm" onClick={() => onOpenReport(invalidReportDate)}><ArrowUpRight className="mr-1 h-4 w-4" />{t("openReport")}</Button>}
      </div>
      : <>
        <dl className="grid grid-cols-[1fr_auto] border border-slate-300 bg-slate-50 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto] dark:border-slate-600 dark:bg-slate-900 [&>*]:border-b [&>*]:border-r [&>*]:border-slate-300 [&>*]:px-3 [&>*]:py-2 dark:[&>*]:border-slate-600">
          <dt>{t("total")}</dt><dd className="text-right font-bold tabular-nums">{money(debts.data.totalAmount)}</dd>
          <dt>{t("unpaidTotal")}</dt><dd className="text-right font-bold tabular-nums">{money(debts.data.unpaidAmount)}</dd>
          <dt>{t("count")}</dt><dd className="text-right font-bold tabular-nums">{debts.data.totalCount}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">{t("totalsNote")}</p>
          <SpreadsheetTable className="min-w-[680px]" aria-label={t("title")}>
            <thead>{table.getHeaderGroups().map(group => <tr key={group.id}><th scope="col" className="w-10 text-center">#</th>{group.headers.map(header => <th scope="col" key={header.id} className={header.column.id === "amount" ? "text-right" : "text-left"}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
            <tbody>{table.getRowModel().rows.map((row, index) => <tr key={row.id}><td className="text-center text-muted-foreground">{pagination.pageIndex * pagination.pageSize + index + 1}</td>{row.getVisibleCells().map(cell => <td className={cell.column.id === "amount" ? "whitespace-nowrap text-right" : cell.column.id === "description" ? "min-w-64 max-w-lg break-words" : "whitespace-nowrap"} key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}
              {debts.data.rows.length === 0 && <tr><td colSpan={8} className="text-center text-muted-foreground">{t(debts.data.totalCount === 0 ? "empty" : "noMatches")}</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={3}>{t("total")}</td><td className="whitespace-nowrap text-right">{formatter.format(debts.data.totalAmount)}</td><td colSpan={4}>{t("count")}: {debts.data.totalCount}</td></tr></tfoot>
          </SpreadsheetTable>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t("matches", { count: debts.data.rowCount })}</p>
            <div className="flex gap-2"><Button variant="outline" size="sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft className="mr-1 h-4 w-4" />{t("previous")}</Button><Button variant="outline" size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>{t("next")}<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
          </div>
      </>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !mutation.isPending) setEditing(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("edit")}</DialogTitle><DialogDescription>{t(editing?.finalized ? "finalizedAmount" : "editDescription")}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (editing && !mutation.isPending) updateDebt(editing, { kind: "edit", description, amount: amount.trim() ? Number(amount) : NaN }); }}>
          <div className="space-y-2"><Label htmlFor="debt-description">{t("reference")}</Label><Input id="debt-description" value={description} maxLength={200} required disabled={mutation.isPending} onChange={event => setDescription(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="debt-amount">{t("amount")} (Lek)</Label><Input id="debt-amount" type="number" min={0} max={1000000000} step="any" required value={amount} disabled={mutation.isPending || editing?.finalized} onChange={event => setAmount(event.target.value)} /></div>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setEditing(null)}>{t("cancel")}</Button><Button type="submit" disabled={mutation.isPending}><Save className="mr-1.5 h-4 w-4" />{t(mutation.isPending ? "saving" : "save")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
