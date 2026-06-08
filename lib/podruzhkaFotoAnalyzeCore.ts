export type PerfumeImageKind = "duo_white" | "single_white" | "other";

export type PerfumeImageAnalysis = {
  kind: PerfumeImageKind;
  score: number;
  whiteRatio: number;
  leftShare: number;
  rightShare: number;
  peakCount: number;
};

function countProductRegions(colWeight: Float32Array, w: number): { regions: number; gapRatio: number } {
  let colMax = 0;
  for (let x = 0; x < w; x++) colMax = Math.max(colMax, colWeight[x]!);
  if (colMax <= 0) return { regions: 0, gapRatio: 0 };

  const thresh = colMax * 0.22;
  let regions = 0;
  let inReg = false;
  let gapCols = 0;

  for (let x = 0; x < w; x++) {
    if (colWeight[x]! >= thresh) {
      if (!inReg) {
        regions++;
        inReg = true;
      }
    } else {
      if (inReg) inReg = false;
      else gapCols++;
    }
  }

  return { regions, gapRatio: gapCols / w };
}

/** Анализ миниатюры: белый фон + два предмета (флакон + коробка) или один флакон. */
export function analyzePerfumePixels(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number
): PerfumeImageAnalysis {
  const colWeight = new Float32Array(w);
  let white = 0;
  let product = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const isWhite = r > 232 && g > 232 && b > 232;
      if (isWhite) white++;
      else {
        product++;
        colWeight[x] += 1;
      }
    }
  }

  const pixels = w * h;
  const whiteRatio = white / pixels;
  const productRatio = product / pixels;

  const mid = Math.floor(w / 2);
  let leftMass = 0;
  let rightMass = 0;
  for (let x = 0; x < mid; x++) leftMass += colWeight[x]!;
  for (let x = mid; x < w; x++) rightMass += colWeight[x]!;

  const totalMass = leftMass + rightMass;
  const leftShare = totalMass > 0 ? leftMass / totalMass : 0;
  const rightShare = totalMass > 0 ? rightMass / totalMass : 0;

  const { regions: peakCount, gapRatio } = countProductRegions(colWeight, w);

  /** Два отдельных предмета (флакон + коробка), между ними «воздух». */
  const twoProducts =
    peakCount >= 2 &&
    gapRatio >= 0.025 &&
    leftShare >= 0.18 &&
    rightShare >= 0.22;

  /** Тени 4stand считаются «товаром» — whiteRatio низкий, productRatio высокий. */
  const shadowHeavyPackshot = whiteRatio < 0.42 && peakCount >= 2;

  const duoWhite =
    twoProducts &&
    whiteRatio >= 0.18 &&
    whiteRatio <= 0.9 &&
    (shadowHeavyPackshot
      ? productRatio >= 0.12 && productRatio <= 0.78
      : productRatio >= 0.08 && productRatio <= 0.58);

  const singleWhite =
    !duoWhite &&
    peakCount <= 1 &&
    whiteRatio >= 0.48 &&
    whiteRatio <= 0.92 &&
    productRatio >= 0.04 &&
    productRatio <= 0.42;

  const whiteScore =
    whiteRatio <= 0.85
      ? whiteRatio * 50
      : whiteRatio * 50 - (whiteRatio - 0.85) * 120;

  if (duoWhite) {
    const balance = Math.min(leftShare, rightShare);
    let score = 130 + whiteScore + balance * 35 + gapRatio * 40;
    // Флакон слева, коробка справа (коробка часто крупнее → rightShare выше)
    if (leftShare >= 0.22 && leftShare <= 0.48 && rightShare >= 0.35) score += 25;
    if (productRatio >= 0.12 && productRatio <= 0.35) score += 15;
    return {
      kind: "duo_white",
      score,
      whiteRatio,
      leftShare,
      rightShare,
      peakCount
    };
  }

  if (singleWhite) {
    return {
      kind: "single_white",
      score: 65 + whiteScore,
      whiteRatio,
      leftShare,
      rightShare,
      peakCount
    };
  }

  return {
    kind: "other",
    score: whiteRatio * 20,
    whiteRatio,
    leftShare,
    rightShare,
    peakCount
  };
}
