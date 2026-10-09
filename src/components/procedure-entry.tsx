"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LoaderCircle, Plus } from "lucide-react";
import { handleSaveProcedures } from "@/app/actions/procedures";
import { PROCEDURE_PRODUCTS, proceduresQueryKey } from "@/lib/procedures";
import { dailyActivityMonthQueryKey } from "@/lib/daily-activity";
import { getMonthlyRepresentatives, type SalesRepresentative } from "@/lib/types";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export function ProcedureEntry({ shopId, date, disabled, onDirtyChange, onDateChange, onSaved, representatives: suppliedRepresentatives, initiallyExpanded = false, showTableLink = true }: {
  shopId: string; date: string; disabled: boolean; onDirtyChange: (dirty: boolean) => void;
  representatives?: SalesRepresentative[];
  onDateChange?: (date: string) => void; onSaved?: () => void; initiallyExpanded?: boolean; showTableLink?: boolean;
}) {
  const t = useTranslations("Procedures");
  const locale = useLocale();
  const { shops } = useShop();
  const shop = shops.find(item => item.id === shopId);
  const representatives = suppliedRepresentatives ?? (shop ? getMonthlyRepresentatives(shop, date.slice(0, 7)) : []);
  const { toast } = useToast();
  const client = useQueryClient();
  const id = useId();
  const [minimized, setMinimized] = useState(!initiallyExpanded);
  const [orderNumber, setOrderNumber] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [product, setProduct] = useState("");
  const [representativeId, setRepresentativeId] = useState("");
  const representative = representatives.find(item => item.id === representativeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const dirty = Boolean(orderNumber || name || customerId || product || representativeId);
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  const reset = () => { setOrderNumber(""); setName(""); setCustomerId(""); setProduct(""); setRepresentativeId(""); setError(null); setEntryId(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || busy) return;
    if (!representative) { setError("representativeRequired"); return; }
    setBusy(true); setError(null);
    try {
      const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Tirane", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
      const recordId = entryId ?? `1-${Date.now()}-${crypto.randomUUID()}`;
      setEntryId(recordId);
      const result = await handleSaveProcedures({ shopId, month: date.slice(0, 7), changes: [{ id: recordId, expectedRevision: 0, representativeId,
        fields: { orderNumber, name, customerId, product: product as typeof PROCEDURE_PRODUCTS[number], user: representative.name, status: "pending", dateTime: `${date}T${now}` } }] });
      if (!result.success) { setError(result.error); return; }
      reset(); onSaved?.();
      await Promise.all([
        client.invalidateQueries({ queryKey: proceduresQueryKey(shopId, date.slice(0, 7)) }),
        client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, date.slice(0, 7)) }),
      ]);
      toast({ title: t("saved") });
    } catch { setError("saveFailed"); } finally { setBusy(false); }
  };
  return <Card className="w-full max-w-[37rem]">
    <CardHeader className="flex-row items-center justify-between space-y-0 px-3 py-2"><CardTitle className="text-sm">{t("title")}</CardTitle>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={t(minimized ? "expand" : "minimize")} title={t(minimized ? "expand" : "minimize")} aria-expanded={!minimized} aria-controls={id} onClick={() => setMinimized(value => !value)}>{minimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</Button>
    </CardHeader>
    <CardContent id={id} hidden={minimized} className="px-3 pb-3 pt-0">
      <form onSubmit={event => void save(event)} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {([{ key: "orderNumber", value: orderNumber, set: setOrderNumber }, { key: "name", value: name, set: setName }, { key: "customerId", value: customerId, set: setCustomerId }] as const).map(field => <label key={field.key} className="space-y-1 text-xs">{t(field.key)}<Input required maxLength={150} value={field.value} disabled={disabled || busy} className="h-8" onChange={event => field.set(event.target.value)} /></label>)}
          <label className="space-y-1 text-xs">{t("product")}<AppSelect required aria-label={t("product")} value={product} disabled={disabled || busy} className="h-8" onValueChange={setProduct} options={[{ value: "", label: t("selectProduct") }, ...PROCEDURE_PRODUCTS.map(value => ({ value, label: value }))]} /></label>
          <label className="col-span-2 space-y-1 text-xs">{t("user")}<AppSelect required aria-label={t("user")} value={representative ? representativeId : ""} disabled={disabled || busy || !representatives.length} className="h-8" onValueChange={setRepresentativeId} options={[{ value: "", label: t("selectRepresentative") }, ...representatives.map(item => ({ value: item.id, label: item.name }))]} /></label>
          {onDateChange && <label className="col-span-2 space-y-1 text-xs">{t("dateTime")}<Input required aria-label={t("entryDate")} type="date" value={date} min={`${date.slice(0, 7)}-01`} max={`${date.slice(0, 7)}-${new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate()}`} disabled={disabled || busy} className="h-8 max-w-48" onChange={event => {
            const next = event.target.value;
            if (/^\d{4}-\d{2}-\d{2}$/.test(next) && next.slice(0, 7) === date.slice(0, 7)) onDateChange(next);
          }} /></label>}
        </div>
        <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" className="h-8" disabled={disabled || busy || !representative}>{busy ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}{t("add")}</Button><Button type="button" size="sm" variant="ghost" disabled={busy || !dirty} onClick={reset}>{t("cancel")}</Button>{showTableLink && <Link className="ml-auto text-xs text-primary underline" href={`/${locale}/shop/${shopId}/procedures?month=${date.slice(0, 7)}`}>{t("openTable")}</Link>}</div>
        <p className="text-xs text-muted-foreground">{t("entryHint", { date })}</p>
        {!representatives.length && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("noRepresentatives")}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{t(`errors.${error}`)}</p>}
      </form>
    </CardContent>
    {dirty && <p className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-300">{t(onDateChange ? "unsavedPageEntry" : "unsavedEntry")}</p>}
  </Card>;
}
