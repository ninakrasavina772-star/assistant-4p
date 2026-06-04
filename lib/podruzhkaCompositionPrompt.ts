/**
 * GPT-4o Vision — эталон reference-target.png (Carolina Herrera / Xerjoff).
 */
export const PODRUZHKA_COMPOSITION_VISION_PROMPT = `# CRITICAL LAYOUT VALIDATION

Эталон (первое изображение) — Carolina Herrera / Подружка Global 1024×1365 (3:4).
Режим replaceOnly: менять только переменные (бренд, тип, аромат, ноты, ml, foto), не двигать декор и не менять палитру.
Не приблизительно, не переосмысливать. Только смена фото товара и текстов.

ПРИОРИТЕТ: 1) Товар 2) Бренд 3) Модель 4) Ноты 5) Объём.

Товар всегда доминирует. product_height/canvas_height должно быть 0.48–0.58.
Ширина товара 50–60% макета. Низ товара 20–50 px над строкой объёма.
Товар в нижней части макета, не по центру вертикали.

ПУСТОТЫ: если пустого места справа/между текстом и товаром больше чем на эталоне — FAIL.
Бренд 40–55% ширины, не доминирует. Модель 70–80% размера бренда.

Ноты: заголовок Bold UPPERCASE #E6007E, описание Regular #666666.
Разделитель #D9D9D9, ширина ~200 px.

Сравни эталон (1) с рендером (2). JSON:
{
  "overallScore": 1-10,
  "needsAdjustment": true/false,
  "productDominanceVerdict": "product_too_small"|"product_ok"|"brand_too_large",
  "photoPositionVerdict": "too_high"|"too_low"|"ok",
  "textSpacingVerdict": "too_tight"|"too_loose"|"ok",
  "reasoning": "одно предложение по-русски"
}
needsAdjustment=true если score<8, товар меньше эталона, или бренд визуально крупнее товара.`;

