import { isAfter, isSameMonth, isValid, parseISO } from "date-fns";
import type { PerformanceData } from "@/lib/types";

type ForecastReport = Pick<PerformanceData, "date" | "asOfDate" | "importedAt">;

export function getForecastDate(report: ForecastReport, now = new Date()) {
  const reportedDate = parseISO(report.asOfDate ?? report.date);
  if (!isValid(reportedDate)) return now;

  const importedDate = report.importedAt ? parseISO(report.importedAt) : undefined;
  const hasMonthStartPlaceholder = reportedDate.getDate() === 1
    && importedDate
    && isValid(importedDate)
    && isSameMonth(reportedDate, importedDate)
    && importedDate.getDate() > 1;

  if (!hasMonthStartPlaceholder) return reportedDate;
  return isAfter(importedDate, now) ? now : importedDate;
}
