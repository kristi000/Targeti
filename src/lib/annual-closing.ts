import { z } from "zod";
import type { MonthlyBankReconciliation } from "@/lib/monthly-bank";

export const closingYearSchema = z.number().int().min(2000).max(9999);
export const closingWorkbookFormatSchema = z.enum(["rak", "inforsd"]);

export function closingWorkbookName(format: "rak" | "inforsd", shopName: string) {
  return `${format === "rak" ? "Rak. arketime" : "INFORSD"} ${shopName}`;
}

function safeDownloadName(value: string): string {
  return Array.from(value.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "")
    .trim().replace(/[. ]+$/, "")).slice(0, 180).join("");
}

export function closingWorkbookFileName(format: "rak" | "inforsd", shopName: string): string {
  return `${safeDownloadName(closingWorkbookName(format, shopName))}.xlsx`;
}

export function closingWorkbookContentDisposition(format: "rak" | "inforsd", shopName: string): string {
  const fileName = closingWorkbookFileName(format, shopName);
  const asciiShopName = shopName.normalize("NFKD").replace(/[\u0300-\u036f]|[^\x20-\x7e]/g, "");
  const fallback = closingWorkbookFileName(format, asciiShopName);
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function closingWorkbookDownloadName(header: string | null, fallback: string): string {
  const extended = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(header ?? "");
  const encoded = /^UTF-8'[^']*'(.*)$/i.exec((extended?.[1] ?? extended?.[2] ?? "").trim())?.[1];
  if (encoded) {
    try {
      const decoded = safeDownloadName(decodeURIComponent(encoded));
      if (decoded) return decoded;
    } catch { /* An invalid extended value can still have a usable filename fallback. */ }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(header ?? "");
  return safeDownloadName(plain?.[1] ?? plain?.[2] ?? "") || safeDownloadName(fallback);
}

export type AnnualClosingDay = {
  date: string;
  boss: number;
  invoice: number;
  unsubscribe: number;
  unsubscribeEntries: { invoice: string; msisdn: string; amount: number }[];
};
export type AnnualClosingMonth = Pick<MonthlyBankReconciliation, "deposits" | "carryover" | "carryoverNote"> & { month: string };
export type AnnualClosingWorkbookData = {
  year: number;
  shopName: string;
  days: AnnualClosingDay[];
  months: AnnualClosingMonth[];
};
