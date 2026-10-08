"use client";
import { Check, Clock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { PROCEDURE_STATUSES, type ProcedureFields } from "@/lib/procedures";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statusAppearance = {
  pending: { icon: Clock, color: "bg-[#ffff00] text-black" },
  completed: { icon: Check, color: "bg-[#00b050] text-black" },
  negative: { icon: X, color: "bg-[#ff0000] text-black" },
} satisfies Record<ProcedureFields["status"], { icon: typeof Clock; color: string }>;

export function ProcedureStatus({ status, label, disabled, onChange }: { status: ProcedureFields["status"]; label?: string; disabled?: boolean; onChange?: (status: ProcedureFields["status"]) => void }) {
  const t = useTranslations("Procedures");
  const appearance = statusAppearance[status];
  const Icon = appearance.icon;
  const statusLabel = t(`statuses.${status}`);
  if (!onChange) return <span role="img" aria-label={statusLabel} title={statusLabel} className={`flex h-8 items-center justify-center ${appearance.color}`}><Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} /></span>;
  return <Select value={status} disabled={disabled} onValueChange={value => onChange(value as ProcedureFields["status"])}>
    <SelectTrigger aria-label={`${label ?? t("status")} · ${statusLabel}`} title={statusLabel} className={`h-8 justify-center rounded-none border-0 px-1 shadow-none focus:ring-inset [&>svg]:hidden ${appearance.color}`}><SelectValue><Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} /></SelectValue></SelectTrigger>
    <SelectContent>{PROCEDURE_STATUSES.map(value => { const OptionIcon = statusAppearance[value].icon; return <SelectItem key={value} value={value}><span className="flex items-center gap-2"><OptionIcon aria-hidden="true" className="h-4 w-4" />{t(`statuses.${value}`)}</span></SelectItem>; })}</SelectContent>
  </Select>;
}
