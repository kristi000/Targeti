"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle, Undo2 } from "lucide-react";
import { fetchDeletedProcedures, handleRestoreProcedures } from "@/app/actions/procedures";
import { deletedProceduresQueryKey, proceduresQueryKey } from "@/lib/procedures";
import { ProcedureStatus } from "@/components/procedure-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DeletedProceduresDialog({ shopId, month, onClose, onRestored }: { shopId: string; month: string; onClose: () => void; onRestored: () => void }) {
  const t = useTranslations("Procedures");
  const locale = useLocale();
  const client = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: deletedProceduresQueryKey(shopId, month, cursor), queryFn: () => fetchDeletedProcedures(shopId, month, cursor) });
  const items = query.data?.items ?? [];
  const locked = busy || query.isFetching;
  const restore = async (records: Array<{ id: string; expectedRevision: number }>) => {
    if (locked || !records.length) return;
    setBusy(true); setError(null);
    try {
      const result = await handleRestoreProcedures({ shopId, month, records });
      if (!result.success) { setError(result.error); return; }
      setSelection({}); setCursor(undefined); setPreviousCursors([]); onRestored();
      await client.invalidateQueries({ queryKey: proceduresQueryKey(shopId, month) });
    } catch { setError("restoreFailed"); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{t("deletedRecords")}</DialogTitle><DialogDescription>{t("restoreHint", { month })}</DialogDescription></DialogHeader>
    {(error || query.isError) && <p role="alert" className="text-sm text-destructive">{t(`errors.${error ?? "loadFailed"}`)}</p>}
    <Button size="sm" className="justify-self-start" disabled={locked || !Object.keys(selection).length} onClick={() => void restore(Object.entries(selection).map(([id, expectedRevision]) => ({ id, expectedRevision })))}>{busy ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1 h-4 w-4" />}{t("restoreSelected", { count: Object.keys(selection).length })}</Button>
    <div className="max-h-[50vh] overflow-auto rounded border"><table className="w-full border-collapse text-xs" aria-label={t("deletedRecords")}><thead><tr className="border-b bg-muted"><th className="p-2"><input type="checkbox" aria-label={t("selectPage")} checked={items.length > 0 && items.every(item => selection[item.id] !== undefined)} disabled={locked || !items.length} onChange={event => setSelection(event.target.checked ? Object.fromEntries(items.map(item => [item.id, item.revision])) : {})} /></th>{(["orderNumber", "name", "product", "status", "deletedAt", "restore"] as const).map(key => <th key={key} scope="col" className="p-2 text-left">{t(key)}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={item.id} className="border-b"><td className="p-2"><input type="checkbox" aria-label={t("selectRow", { number: index + 1 + previousCursors.length * 50 })} checked={selection[item.id] !== undefined} disabled={locked} onChange={event => setSelection(previous => { const next = { ...previous }; if (event.target.checked) next[item.id] = item.revision; else delete next[item.id]; return next; })} /></td><td className="p-2">{item.orderNumber}</td><td className="p-2">{item.name}</td><td className="whitespace-nowrap p-2">{item.product}</td><td className="p-2"><ProcedureStatus status={item.status} /></td><td className="whitespace-nowrap p-2"><time dateTime={item.deletedAt}>{new Intl.DateTimeFormat(locale, { timeZone: "Europe/Tirane", dateStyle: "short", timeStyle: "short" }).format(new Date(item.deletedAt))}</time></td><td className="p-2"><Button size="icon" variant="ghost" className="h-7 w-7" disabled={locked} aria-label={t("restoreRow", { number: index + 1 + previousCursors.length * 50 })} onClick={() => void restore([{ id: item.id, expectedRevision: item.revision }])}><Undo2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table>{query.isPending ? <p role="status" className="p-3 text-sm">{t("loading")}</p> : !items.length && !query.isError && <p role="status" className="p-3 text-sm text-muted-foreground">{t("emptyDeleted")}</p>}</div>
    <div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={locked || !previousCursors.length} onClick={() => { setSelection({}); setCursor(previousCursors.at(-1)); setPreviousCursors(previous => previous.slice(0, -1)); }}>{t("previous")}</Button><span className="text-xs">{t("page", { number: previousCursors.length + 1 })}</span><Button size="sm" variant="outline" disabled={locked || !query.data?.nextCursor} onClick={() => { setSelection({}); setPreviousCursors(previous => [...previous, cursor]); setCursor(query.data!.nextCursor!); }}>{t("next")}</Button></div>
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t("close")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
