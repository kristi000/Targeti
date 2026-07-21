const REPORTING_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function formatReportingMonth(month: string, locale: string): string {
  const match = REPORTING_MONTH_PATTERN.exec(month);
  if (!match) return month;

  const [, year, monthNumber] = match;
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1));

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatReportingExcelDate(importedAt: string, locale: string): string {
  const date = new Date(importedAt);
  if (Number.isNaN(date.getTime())) return importedAt;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}
