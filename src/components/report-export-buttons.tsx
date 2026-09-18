"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ReportExportFormat } from "@/lib/report-export";

export function ReportExportButtons({ disabled, exporting, onExport }: {
  disabled: boolean;
  exporting: ReportExportFormat | null;
  onExport: (format: ReportExportFormat) => void;
}) {
  const t = useTranslations("ReportExport");
  return <div className="flex flex-wrap gap-1.5">
    <Button variant="outline" size="sm" className="h-8" disabled={disabled || exporting !== null} onClick={() => onExport("csv")}><Download className="mr-1.5 h-3.5 w-3.5" />{t(exporting === "csv" ? "exporting" : "exportCsv")}</Button>
    <Button variant="outline" size="sm" className="h-8" disabled={disabled || exporting !== null} onClick={() => onExport("xlsx")}><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />{t(exporting === "xlsx" ? "exporting" : "exportExcel")}</Button>
  </div>;
}
