import type ExcelJS from "exceljs";
import { cellPlainValue } from "@/lib/ozonImageExcel";
import { normHeader } from "@/lib/templateGenerator/presets";
import type { TemplateColumnMeta, TemplateRowContext, TemplateSheetScan } from "@/lib/templateGenerator/types";

const VOLUME_HEADER_RE = /объ[eё]м|volume|флакон.*мл|\bмл\b/i;

export function isVolumeHeader(header: string): boolean {
  return VOLUME_HEADER_RE.test(header);
}

export function extractMlValues(...texts: string[]): number[] {
  const out = new Set<number>();
  for (const text of texts) {
    if (!text?.trim()) continue;
    const re = /\b(\d{1,4})\s*(?:мл|ml)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = parseInt(m[1]!, 10);
      if (n > 0 && n < 5000) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function pickBrand(cells: Record<string, string>): string {
  for (const [k, v] of Object.entries(cells)) {
    if (/^бренд/i.test(k) && v.trim()) return v.trim();
  }
  return "";
}

function normalizeNameKey(brand: string, name: string): string {
  const blob = `${brand} ${name}`
    .toLowerCase()
    .replace(/\b\d+\s*(?:мл|ml|g|г|л)\b/gi, " ")
    .replace(/\b(?:eau de parfum|edt|edp|for women|for men)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return blob.length >= 10 ? blob : "";
}

export function findCommentHeader(columns: TemplateColumnMeta[]): string | null {
  for (const c of columns) {
    const h = c.header.toLowerCase();
    if (
      /дополнительн.*информ|прочие характер|коммент|примечан|review|заметк/i.test(h)
    ) {
      return c.header;
    }
  }
  return null;
}

export type ContradictionNote = {
  row: number;
  volumeHeader: string;
  mergedValue: string;
  comment: string;
};

/** Противоречия по объёму внутри строки и между вариациями одного названия */
export function detectVolumeContradictions(
  contexts: TemplateRowContext[],
  columns: TemplateColumnMeta[]
): ContradictionNote[] {
  const volumeHeaders = columns.filter((c) => isVolumeHeader(c.header)).map((c) => c.header);
  if (!volumeHeaders.length) return [];

  const titleHeader = columns.find((c) => /название товара/i.test(c.header))?.header;
  const notes: ContradictionNote[] = [];
  const notedRows = new Set<number>();

  const pushNote = (note: ContradictionNote) => {
    if (notedRows.has(note.row)) return;
    notedRows.add(note.row);
    notes.push(note);
  };

  for (const ctx of contexts) {
    const title = titleHeader ? ctx.cells[titleHeader] ?? "" : "";
    const colTexts = volumeHeaders.map((h) => ctx.cells[h] ?? "").filter(Boolean);
    const vols = extractMlValues(title, ...colTexts);
    if (vols.length > 1) {
      pushNote({
        row: ctx.row,
        volumeHeader: volumeHeaders[0]!,
        mergedValue: vols.map((v) => `${v} мл`).join(", "),
        comment: `⚠ Противоречие по объёму: ${vols.join(", ")} мл — проверьте карточку.`
      });
    }
  }

  const byName = new Map<string, TemplateRowContext[]>();
  for (const ctx of contexts) {
    const name = titleHeader ? ctx.cells[titleHeader] ?? "" : "";
    const key = normalizeNameKey(pickBrand(ctx.cells), name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(ctx);
  }

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const allVols = new Set<number>();
    for (const ctx of group) {
      const title = titleHeader ? ctx.cells[titleHeader] ?? "" : "";
      extractMlValues(title, ...volumeHeaders.map((h) => ctx.cells[h] ?? "")).forEach((v) =>
        allVols.add(v)
      );
    }
    if (allVols.size <= 1) continue;
    const merged = [...allVols].sort((a, b) => a - b).map((v) => `${v} мл`).join(", ");
    const comment = `⚠ Противоречие по объёму между вариациями (${merged}) — нужна проверка.`;
    for (const ctx of group) {
      pushNote({
        row: ctx.row,
        volumeHeader: volumeHeaders[0]!,
        mergedValue: merged,
        comment
      });
    }
  }

  return notes;
}

export function applyContradictionNotes(
  ws: ExcelJS.Worksheet,
  scan: TemplateSheetScan,
  notes: ContradictionNote[]
): number {
  if (!notes.length) return 0;

  const colByHeader = new Map(scan.columns.map((c) => [c.header, c.col]));
  const commentHeader = findCommentHeader(scan.columns);
  const commentCol = commentHeader ? colByHeader.get(commentHeader) : null;
  let n = 0;

  for (const note of notes) {
    const volCol = colByHeader.get(note.volumeHeader);
    if (volCol) {
      ws.getCell(note.row, volCol).value = note.mergedValue;
      n++;
    }
    if (commentCol) {
      const existing = cellPlainValue(ws.getCell(note.row, commentCol).value).trim();
      const next = existing.includes(note.comment)
        ? existing
        : existing
          ? `${existing}\n${note.comment}`
          : note.comment;
      ws.getCell(note.row, commentCol).value = next;
    }
  }

  return n;
}
