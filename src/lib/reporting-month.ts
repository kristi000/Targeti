const REPORTING_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function formatReportingMonth(month: string, locale: string, monthStyle: "long" | "short" = "long"): string {
  const match = REPORTING_MONTH_PATTERN.exec(month);
  if (!match) return month;

  const [, year, monthNumber] = match;
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1));

  return new Intl.DateTimeFormat(locale, {
    month: monthStyle,
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatReportingDate(reportDate: string, locale: string, monthStyle: "long" | "short" = "long"): string {
  const date = new Date(`${reportDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return reportDate;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: monthStyle,
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
