import type { AnnualClosingWorkbookData } from "@/lib/annual-closing";
import {
  excelDateSerial, packClosingWorkbook, patchWorkbookCell, readWorkbookXml,
  renumberWorkbookRow, unpackClosingWorkbook, workbookCellXml, writeWorkbookXml,
  type WorkbookCellValue,
} from "@/lib/closing-workbook-xml";

const MONTH_NAMES = ["Janar", "Shkurt", "Mars", "Prill", "Maj", "Qershor", "Korrik", "Gusht", "Shtator", "Tetor", "Nentor", "Dhjetor"];

function worksheetRows(source: string): Map<number, string> {
  return new Map([...source.matchAll(/<row\b(?=[^>]*\br="(\d+)")[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)]
    .map(match => [Number(match[1]), match[0]]));
}

function renderRow(prototype: string, row: number, values: Map<string, WorkbookCellValue>): string {
  return renumberWorkbookRow(prototype, row).replace(/<c\b(?=[^>]*\br="([A-Z]+)\d+")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,
    (cell: string, column: string) => workbookCellXml(`${column}${row}`, values.get(column) ?? null, cell));
}

function replacePrintRanges(workbook: string, ranges: string[]): string {
  const names = ranges.map((range, index) => `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${range}</definedName>`).join("");
  const existing = workbook.match(/<definedNames\b[^>]*>([\s\S]*?)<\/definedNames>/)?.[1] ?? "";
  const remaining = existing.replace(/<definedName\b(?=[^>]*\bname="_xlnm\.Print_(?:Area|Titles)")[^>]*>[\s\S]*?<\/definedName>/g, "");
  const replacement = `<definedNames>${remaining}${names}</definedNames>`;
  if (/<definedNames\b/.test(workbook)) return workbook.replace(/<definedNames\b[^>]*(?:\/>|>[\s\S]*?<\/definedNames>)/, () => replacement);
  return workbook.replace("</sheets>", `</sheets>${replacement}`);
}

export function exportInforsdWorkbook(templateBytes: Uint8Array, data: AnnualClosingWorkbookData): Uint8Array {
  const files = unpackClosingWorkbook(templateBytes);
  const savedDays = new Map(data.days.map(day => [day.date, day]));
  const printRanges: string[] = [];
  const totals: { boss: number; real: number; row: number }[] = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const path = `xl/worksheets/sheet${monthIndex + 1}.xml`;
    let source = readWorkbookXml(files, path);
    const rows = worksheetRows(source);
    const blocks = [...source.matchAll(/<mergeCell\b[^>]*\bref="A(\d+):A(\d+)"[^>]*\/>/g)]
      .map(match => ({ start: Number(match[1]), end: Number(match[2]) })).sort((a, b) => a.start - b.start);
    const totalBlock = blocks.pop();
    if (!totalBlock || blocks.length < 28 || !rows.get(1)) throw new Error("invalidTemplate");
    const outputRows = [rows.get(1)!];
    const merges: string[] = [];
    const daysInMonth = new Date(Date.UTC(data.year, monthIndex + 1, 0)).getUTCDate();
    let nextRow = 2;
    let bossTotal = 0;
    let realTotal = 0;

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
      const date = `${data.year}-${String(monthIndex + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
      const day = savedDays.get(date);
      const entries = day?.unsubscribeEntries ?? [];
      if (entries.length > 100) throw new Error("templateCapacity");
      const original = blocks[Math.min(dayNumber - 1, blocks.length - 1)];
      const originalLength = original.end - original.start + 1;
      const length = Math.max(originalLength, entries.length);
      const start = nextRow;
      const end = start + length - 1;
      const serial = excelDateSerial(date);

      for (let offset = 0; offset < length; offset++) {
        // Keep the original top/bottom borders and use a middle row for extra entries.
        const originalOffset = offset === length - 1 ? originalLength - 1 : Math.min(offset, originalLength - 2);
        const prototype = rows.get(original.start + originalOffset);
        if (!prototype) throw new Error("invalidTemplate");
        const values = new Map<string, WorkbookCellValue>([["I", serial], ["J", data.shopName]]);
        if (offset === 0) {
          values.set("A", serial);
          if (day) {
            values.set("B", day.boss);
            values.set("C", day.boss - day.unsubscribe);
            values.set("D", { formula: `B${start}-C${start}`, value: day.unsubscribe });
          }
        }
        const entry = entries[offset];
        if (entry) {
          values.set("E", entry.amount);
          values.set("F", entry.invoice);
          values.set("G", entry.msisdn);
          values.set("H", "unsubscribe");
        }
        outputRows.push(renderRow(prototype, nextRow++, values));
      }
      for (const column of ["A", "B", "C", "D"]) merges.push(`<mergeCell ref="${column}${start}:${column}${end}"/>`);
      if (day) {
        bossTotal += day.boss;
        realTotal += day.boss - day.unsubscribe;
      }
    }

    const totalRow = nextRow;
    const totalLength = totalBlock.end - totalBlock.start + 1;
    for (let offset = 0; offset < totalLength; offset++) {
      const prototype = rows.get(totalBlock.start + offset);
      if (!prototype) throw new Error("invalidTemplate");
      const values = new Map<string, WorkbookCellValue>();
      if (offset === 0) {
        values.set("A", "Total");
        values.set("B", { formula: `SUM(B2:B${totalRow - 1})`, value: bossTotal });
        values.set("C", { formula: `SUM(C2:C${totalRow - 1})`, value: realTotal });
        values.set("D", { formula: `SUM(D2:D${totalRow - 1})`, value: bossTotal - realTotal });
      }
      outputRows.push(renderRow(prototype, nextRow++, values));
    }
    for (const column of ["A", "B", "C", "D"]) merges.push(`<mergeCell ref="${column}${totalRow}:${column}${nextRow - 1}"/>`);
    source = source.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, () => `<sheetData>${outputRows.join("")}</sheetData>`)
      .replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/, () => `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`);
    const dimension = `<dimension ref="A1:J${nextRow - 1}"/>`;
    source = /<dimension\b/.test(source) ? source.replace(/<dimension\b[^>]*\/>/, dimension) : source.replace(/<sheetViews\b/, `${dimension}<sheetViews`);
    writeWorkbookXml(files, path, source);
    totals.push({ boss: bossTotal, real: realTotal, row: totalRow });
    printRanges.push(`'${MONTH_NAMES[monthIndex]}'!$A$1:$J$${nextRow - 1}`);
  }

  const totalPath = "xl/worksheets/sheet13.xml";
  let annual = readWorkbookXml(files, totalPath);
  annual = patchWorkbookCell(annual, "B1", data.year);
  for (const [index, total] of totals.entries()) {
    const row = index + 5;
    annual = patchWorkbookCell(annual, `C${row}`, { formula: `'${MONTH_NAMES[index]}'!B${total.row}`, value: total.boss });
    annual = patchWorkbookCell(annual, `D${row}`, { formula: `'${MONTH_NAMES[index]}'!C${total.row}`, value: total.real });
    annual = patchWorkbookCell(annual, `E${row}`, { formula: `D${row}-C${row}`, value: total.real - total.boss });
  }
  const annualBoss = totals.reduce((sum, month) => sum + month.boss, 0);
  const annualReal = totals.reduce((sum, month) => sum + month.real, 0);
  annual = patchWorkbookCell(annual, "C17", { formula: "SUM(C5:C16)", value: annualBoss });
  annual = patchWorkbookCell(annual, "D17", { formula: "SUM(D5:D16)", value: annualReal });
  annual = patchWorkbookCell(annual, "E17", { formula: "D17-C17", value: annualReal - annualBoss });
  annual = annual.replace(/(<sheetData\b[^>]*>)([\s\S]*?)(<\/sheetData>)/, (_match, open: string, content: string, close: string) =>
    `${open}${[...worksheetRows(`<sheetData>${content}</sheetData>`)].filter(([row]) => row <= 17).map(([, xml]) => xml).join("")}${close}`);
  writeWorkbookXml(files, totalPath, annual);
  printRanges.push("'TOTAL'!$B$1:$E$17");
  writeWorkbookXml(files, "xl/workbook.xml", replacePrintRanges(readWorkbookXml(files, "xl/workbook.xml"), printRanges));
  return packClosingWorkbook(files);
}
