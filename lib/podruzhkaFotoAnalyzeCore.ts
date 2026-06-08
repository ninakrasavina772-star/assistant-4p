export type PerfumeImageKind = "duo_white" | "single_white" | "other";

export type PerfumeImageAnalysis = {
  kind: PerfumeImageKind;
  score: number;
  whiteRatio: number;
  leftShare: number;
  rightShare: number;
};

/** Анализ миниатюры: белый фон + два предмета (флакон слева, коробка справа) или один флакон. */
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

  const duoWhite =
    whiteRatio >= 0.42 &&
    productRatio >= 0.06 &&
    productRatio <= 0.55 &&
    leftShare >= 0.2 &&
    rightShare >= 0.2;

  const singleWhite =
    !duoWhite &&
    whiteRatio >= 0.48 &&
    productRatio >= 0.04 &&
    productRatio <= 0.45 &&
    Math.max(leftShare, rightShare) >= 0.55;

  if (duoWhite) {
    const balance = Math.min(leftShare, rightShare);
    let score = 120 + whiteRatio * 50 + balance * 40;
    // Флакон слева, коробка справа
    if (leftShare > rightShare) score += (leftShare - rightShare) * 35;
    return {
      kind: "duo_white",
      score,
      whiteRatio,
      leftShare,
      rightShare
    };
  }

  if (singleWhite) {
    return {
      kind: "single_white",
      score: 70 + whiteRatio * 40,
      whiteRatio,
      leftShare,
      rightShare
    };
  }

  return { kind: "other", score: whiteRatio * 25, whiteRatio, leftShare, rightShare };
}
