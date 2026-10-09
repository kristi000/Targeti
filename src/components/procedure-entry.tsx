"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LoaderCircle, Plus } from "lucide-react";
import { handleSaveProcedures } from "@/app/actions/procedures";
import { PROCEDURE_PRODUCTS, proceduresQueryKey } from "@/lib/procedures";
import { dailyActivityMonthQueryKey } from "@/lib/daily-activity";
import { getMonthlyRepresentatives } from "@/lib/types";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export function ProcedureEntry({ shopId, date, disabled, onDirtyChange }: { shopId: string; date: string; disabled: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("Procedures");
  const locale = useLocale();
  const { shops } = useShop();
  const shop = shops.find(item => item.id === shopId);
  const representatives = shop ? getMonthlyRepresentatives(shop, date.slice(0, 7)) : [];
  const { toast } = useToast();
  const client = useQueryClient();
  const id = useId();
  const [minimized, setMinimized] = useState(true);
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
      await Promise.all([
        client.invalidateQueries({ queryKey: proceduresQueryKey(shopId, date.slice(0, 7)) }),
        client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, date.slice(0, 7)) }),
      ]);
      reset(); toast({ title: t("saved") });
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
          <label className="space-y-1 text-xs">{t("product")}<select required aria-label={t("product")} value={product} disabled={disabled || busy} className="h-8 w-full rounded-md border bg-background px-2 text-sm" onChange={event => setProduct(event.target.value)}><option value="">{t("selectProduct")}</option>{PROCEDURE_PRODUCTS.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="col-span-2 space-y-1 text-xs">{t("user")}<select required aria-label={t("user")} value={representative ? representativeId : ""} disabled={disabled || busy || !representatives.length} className="h-8 w-full rounded-md border bg-background px-2 text-sm" onChange={event => setRepresentativeId(event.target.value)}><option value="">{t("selectRepresentative")}</option>{representatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" className="h-8" disabled={disabled || busy || !representative}>{busy ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}{t("add")}</Button><Button type="button" size="sm" variant="ghost" disabled={busy || !dirty} onClick={reset}>{t("cancel")}</Button><Link className="ml-auto text-xs text-primary underline" href={`/${locale}/shop/${shopId}/procedures?month=${date.slice(0, 7)}`}>{t("openTable")}</Link></div>
        <p className="text-xs text-muted-foreground">{t("entryHint", { date })}</p>
        {!representatives.length && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("noRepresentatives")}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{t(`errors.${error}`)}</p>}
      </form>
    </CardContent>
    {dirty && <p className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-300">{t("unsavedEntry")}</p>}
  </Card>;
}
