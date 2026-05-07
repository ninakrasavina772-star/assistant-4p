/// <reference types="node" />

/**
 * В middleware (Edge) и в сборке Vercel TypeScript 5.9+ иначе ругается на `process`.
 * Глобальные типы Node не подтягиваются в изолированной проверке Edge.
 */
export {};
