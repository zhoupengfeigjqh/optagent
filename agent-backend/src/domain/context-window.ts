
/** 池子上限（条）：达到即归档；正文注入量不会超过它。1 轮正常对话 = 2 条消息，故约 30 轮 */
export const POOL_MAX_MESSAGES = 60;

export const ARCHIVE_BATCH_MESSAGES = 20;

/** 归档后池子保留长度（条）= 上限 - 批次；正文注入量在 [该值, 上限) 之间波动 */
export const POOL_RESERVED_MESSAGES = POOL_MAX_MESSAGES - ARCHIVE_BATCH_MESSAGES;
