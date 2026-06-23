/** Правила контента для витрины Яндекс Маркета */

const TITLE_MIN_LEN = 120;
const DESCRIPTION_MIN_LEN = 600;

const TITLE_PAD_ADJECTIVES = [
  "легкий",
  "повседневный",
  "унисекс",
  "стойкий",
  "изысканный",
  "премиальный",
  "ароматный",
  "нежный",
  "свежий",
  "элегантный"
];

export function isYandexTitleHeader(header: string): boolean {
  const h = header.toLowerCase();
  return /название товара/.test(h);
}

export function isYandexDescriptionHeader(header: string): boolean {
  const h = header.toLowerCase();
  return /описание/.test(h) && !/кратк|short|seo/i.test(h);
}

export const YANDEX_SYSTEM_APPEND = `
Дополнительные правила для Яндекс Маркета:

НАЗВАНИЕ ТОВАРА (если поле в списке):
- Структура: Тип товара + Бренд + Модель/линейка + уточняющие характеристики (аромат, объём, ноты).
- Минимум ${TITLE_MIN_LEN} символов. Если короче — добавь 1–2 уместных прилагательных в конец (лёгкий, повседневный, стойкий и т.п.).
- Пример: «Парфюмерная вода Ariana Grande Ari фруктовый аромат легкий повседневный унисекс»

ОПИСАНИЕ ТОВАРА (если поле в списке):
- Минимум ${DESCRIPTION_MIN_LEN} символов, лучше 800–1500.
- Строго по блокам (каждый блок — отдельный абзац, пустая строка между блоками):
  БЛОК 1: Название товара (одна строка)
  БЛОК 2: Описание товара и отличительные особенности (2–4 предложения)
  БЛОК 3: 2–3 предложения о бренде
  БЛОК 4: Один уникальный факт о товаре (1 предложение)
  БЛОК 5: Короткая фраза про оригинальность (без гарантий и юридических обещаний)
  БЛОК 6: Как использовать и польза для покупателя
- Для парфюма после блока о бренде можно добавить пирамиду аромата (верх/сердце/база) и раскрытие нот.
- Без КАПСА целиком, без выдуманных штрихкодов и цен.`;

export function buildYandexFieldHint(header: string): string | null {
  if (isYandexTitleHeader(header)) {
    return `Яндекс Маркет: тип + бренд + модель, минимум ${TITLE_MIN_LEN} символов`;
  }
  if (isYandexDescriptionHeader(header)) {
    return `Яндекс Маркет: структурированное описание по 6 блокам, минимум ${DESCRIPTION_MIN_LEN} символов`;
  }
  return null;
}

/** Дополнить название до минимальной длины прилагательными */
export function padYandexTitle(title: string): string {
  let t = title.trim();
  if (t.length >= TITLE_MIN_LEN) return t;
  let i = 0;
  while (t.length < TITLE_MIN_LEN && i < TITLE_PAD_ADJECTIVES.length) {
    const adj = TITLE_PAD_ADJECTIVES[i]!;
    if (!t.toLowerCase().includes(adj)) {
      t = `${t} ${adj}`.trim();
    }
    i++;
  }
  return t;
}

export function yandexDescriptionTooShort(text: string): boolean {
  return text.trim().length < DESCRIPTION_MIN_LEN;
}
