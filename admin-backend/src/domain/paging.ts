/**
 * 卡片列表分页（`FR-006`、`SC-022`、`SC-023`）。
 *
 * **每页固定 `page_size = 8`（4 列 × 2 行）**，由服务端固定、
 * **不接受客户端覆盖**——因此这里没有"页大小"参数，只有页码。
 *
 * 非卡片类长列表（工具清单、日志、部署历史、异常汇总）不用本模块，
 * 它们走"有界返回"（`limit` + 条数上限）。
 */
import { ApiError } from './api-error.js';
import { ERROR_CODES } from './error-codes.js';

/** 服务端固定的每页条数 */
export const CARD_PAGE_SIZE = 8;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 解析页码：缺省 1；非正整数或 <1 即 `VALIDATION_FAILED` */
export function normalizePage(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 1;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `page 须为 ≥1 的整数（当前：${String(raw)}）`);
  }
  return value;
}

/** 切片并生成统一分页响应 */
export function paginate<T>(items: readonly T[], page: number): Paged<T> {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / CARD_PAGE_SIZE);
  const start = (page - 1) * CARD_PAGE_SIZE;
  return {
    items: items.slice(start, start + CARD_PAGE_SIZE),
    total,
    page,
    page_size: CARD_PAGE_SIZE,
    total_pages: totalPages,
  };
}

/** 解析"有界返回"的 limit：默认值 + 1~上限 */
export function normalizeLimit(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `limit 须为 ≥1 的整数（当前：${String(raw)}）`);
  }
  return Math.min(value, max);
}
