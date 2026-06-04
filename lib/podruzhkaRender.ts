import sharp from "sharp";
import type { PodruzhkaInfographicData } from "@/lib/podruzhkaTypes";
import { assertFetchableImageUrl, defaultAllowedHosts } from "@/lib/ozonImageUrls";

const W = 900;
const H = 1200;
const PINK = "#E91E8C";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMl(ml: string): string {
  const t = ml.trim();
  if (!t) return "";
  if (/мл|ml/i.test(t)) return t.replace(/\s*ml\b/i, " мл");
  const n = t.replace(/[^\d.,]/g, "");
  return n ? `${n} мл` : t;
}

export function buildInfographicSvg(data: PodruzhkaInfographicData): string {
  const brand = esc(data.brandName.toUpperCase());
  const ptype = esc(data.productType);
  const model = esc(data.model);
  const vol = esc(formatMl(data.ml));
  const notes = data.notes.slice(0, 3);

  let yNotes = 340;
  const noteBlocks: string[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const title = esc(n.title.toUpperCase());
    const desc = esc(n.desc);
    noteBlocks.push(`
      <line x1="48" y1="${yNotes - 8}" x2="128" y2="${yNotes - 8}" stroke="${PINK}" stroke-width="3"/>
      <text x="48" y="${yNotes + 28}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${PINK}">${title}</text>
      <text x="48" y="${yNotes + 52}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#6b6b6b">${desc}</text>
    `);
    if (i < 2) {
      noteBlocks.push(
        `<line x1="48" y1="${yNotes + 72}" x2="320" y2="${yNotes + 72}" stroke="#d0d0d0" stroke-width="1"/>`
      );
    }
    yNotes += 100;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#e8e8e8"/>
  <ellipse cx="780" cy="180" rx="220" ry="200" fill="#f5f5f5" opacity="0.9"/>
  <ellipse cx="820" cy="120" rx="160" ry="140" fill="#ffffff" opacity="0.5"/>
  <rect x="225" y="36" width="450" height="52" rx="26" fill="#0a0a0a"/>
  <text x="450" y="70" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="#ffffff">✈  подружка Global</text>
  <text x="48" y="155" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#0a0a0a">${brand}</text>
  <text x="48" y="195" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#7a7a7a">${ptype}</text>
  <text x="48" y="240" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#0a0a0a">${model}</text>
  <line x1="48" y1="268" x2="128" y2="268" stroke="${PINK}" stroke-width="3"/>
  ${noteBlocks.join("\n")}
  <line x1="48" y1="1080" x2="128" y2="1080" stroke="${PINK}" stroke-width="3"/>
  <text x="48" y="1125" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#0a0a0a">${vol}</text>
</svg>`;
}

async function fetchProductImage(url: string): Promise<Buffer> {
  const allowed = defaultAllowedHosts();
  assertFetchableImageUrl(url, allowed);
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000)
  });
  if (!res.ok) throw new Error(`Фото товара: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Пустое фото товара");
  return buf;
}

export async function renderInfographicPng(data: PodruzhkaInfographicData): Promise<Buffer> {
  const svg = buildInfographicSvg(data);
  const base = await sharp(Buffer.from(svg)).png().toBuffer();

  let productBuf: Buffer | null = null;
  if (data.fotoUrl) {
    try {
      productBuf = await fetchProductImage(data.fotoUrl);
      productBuf = await sharp(productBuf)
        .resize({
          width: 480,
          height: 880,
          fit: "contain",
          background: { r: 232, g: 232, b: 232, alpha: 0 }
        })
        .png()
        .toBuffer();
    } catch {
      productBuf = null;
    }
  }

  if (!productBuf) {
    return sharp(base).resize({ width: W, height: H }).jpeg({ quality: 92 }).toBuffer();
  }

  return sharp(base)
    .composite([{ input: productBuf, left: 400, top: 260 }])
    .resize({ width: W, height: H })
    .jpeg({ quality: 92 })
    .toBuffer();
}
