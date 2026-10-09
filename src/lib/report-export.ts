export type ReportExportFormat = "csv" | "xlsx";
export type ReportExportColumn<Row> = {
  header: string;
  value: (row: Row) => string | number;
  width?: number;
  numberFormat?: string;
};

function csvCell(value: string | number) {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportReport<Row>({
  rows,
  columns,
  fileName,
  sheetName,
  format,
}: {
  rows: Row[];
  columns: ReportExportColumn<Row>[];
  fileName: string;
  sheetName: string;
  format: ReportExportFormat;
}) {
  if (format === "xlsx") {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    await writeXlsxFile([
      columns.map(column => ({ value: column.header, fontWeight: "bold" as const })),
      ...rows.map(row => columns.map(column => {
        const value = column.value(row);
        return typeof value === "number"
          ? { value, type: Number, format: column.numberFormat ?? "#,##0.00" }
          : { value };
      })),
    ], {
      columns: columns.map(column => ({ width: column.width ?? 16 })),
      sheet: sheetName.slice(0, 31),
    }).toFile(`${fileName}.xlsx`);
    return;
  }

  const csv = `\uFEFF${[
    columns.map(column => column.header),
    ...rows.map(row => columns.map(column => column.value(row))),
  ].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
