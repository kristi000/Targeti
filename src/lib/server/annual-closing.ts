import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { adminDb as db, documentId } from "@/lib/firebase-admin";
import { requireShopAccess } from "@/lib/access";
import { requireRestrictedAccess } from "@/lib/restricted-access";
import {
  attendanceDateSchema, dailyClosingInputSchema, monthlyBankDocumentSchema, shopIdSchema, shopSchema,
} from "@/lib/persistence-schemas";
import { closingYearSchema, closingWorkbookFormatSchema, type AnnualClosingWorkbookData } from "@/lib/annual-closing";
import { emptyMonthlyBankReconciliation } from "@/lib/monthly-bank";
import { exportRakWorkbook } from "@/lib/rak-workbook";
import { exportInforsdWorkbook } from "@/lib/inforsd-workbook";

const closingAmountsSchema = dailyClosingInputSchema.pick({ adjustments: true, unsubscribeEntries: true }).strip();

export async function loadAnnualClosingWorkbookData(shopId: string, year: number): Promise<AnnualClosingWorkbookData> {
  shopIdSchema.parse(shopId);
  closingYearSchema.parse(year);
  await requireRestrictedAccess();
  await requireShopAccess(shopId);
  const shopRef = db.collection("shops").doc(shopId);
  const closingQuery = shopRef.collection("dailyClosings")
    .where(documentId(), ">=", `${year}-01-01`).where(documentId(), "<=", `${year}-12-31`)
    .orderBy(documentId()).limit(367);
  const bankQuery = shopRef.collection("bankReconciliations")
    .where(documentId(), ">=", `${year}-01`).where(documentId(), "<=", `${year}-12`)
    .orderBy(documentId()).limit(13);
  // Read every source at one transaction snapshot so a concurrent save cannot mix report versions.
  return db.runTransaction(async transaction => {
    const [shopSnapshot, closings, banks] = await Promise.all([
      transaction.get(shopRef), transaction.get(closingQuery), transaction.get(bankQuery),
    ]);
    if (!shopSnapshot.exists) throw new Error("SHOP_NOT_FOUND");
    if (closings.size > 366 || banks.size > 12) throw new Error("INVALID_ANNUAL_CLOSING");
    const shop = shopSchema.parse({ id: shopId, ...shopSnapshot.data() });
    const days = closings.docs.map(document => {
      const date = attendanceDateSchema.parse(document.id);
      const closing = closingAmountsSchema.parse(document.data());
      const unsubscribeEntries = closing.unsubscribeEntries.length
        ? closing.unsubscribeEntries.map(({ invoice, msisdn, amount }) => ({ invoice, msisdn, amount }))
        : closing.adjustments.unsubscribe > 0
          ? [{ invoice: "Legacy entry", msisdn: "", amount: closing.adjustments.unsubscribe }]
          : [];
      return {
        date, boss: closing.adjustments.boss, invoice: closing.adjustments.invoice,
        unsubscribe: unsubscribeEntries.reduce((total, entry) => total + entry.amount, 0), unsubscribeEntries,
      };
    });
    const reconciliations = new Map(banks.docs.map(document => {
      const data = monthlyBankDocumentSchema.parse(document.data());
      if (data.month !== document.id) throw new Error("INVALID_BANK_RECONCILIATION");
      return [document.id, data];
    }));
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      const data = reconciliations.get(month) ?? emptyMonthlyBankReconciliation();
      return { month, deposits: data.deposits, carryover: data.carryover, carryoverNote: data.carryoverNote };
    });
    return { year, shopName: shop.name, days, months };
  });
}

export async function generateAnnualClosingWorkbook(shopId: string, year: number, format: "rak" | "inforsd") {
  closingWorkbookFormatSchema.parse(format);
  const data = await loadAnnualClosingWorkbookData(shopId, year);
  const template = new Uint8Array(await readFile(join(process.cwd(), "src", "lib", "server", "templates", `${format}.xlsx`)));
  const bytes = format === "rak" ? exportRakWorkbook(template, data) : exportInforsdWorkbook(template, data);
  return { bytes, shopName: data.shopName };
}
