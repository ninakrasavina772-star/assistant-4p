/**
 * Лимиты одного запроса к OpenAI (дубли UI + /api/ai/dup-refine).
 * Vision дороже по токенам и таймаутам — порог ниже.
 */
export const AI_DUP_MAX_PAIRS_TEXT_PER_REQUEST = 200;
export const AI_DUP_MAX_PAIRS_VISION_PER_REQUEST = 72;

/** Размер чанка внутри одного HTTP-запроса к OpenAI (несколько чанков подряд). */
export const AI_DUP_CHUNK_TEXT = 16;
export const AI_DUP_CHUNK_VISION = 6;
