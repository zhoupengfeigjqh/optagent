/**
 * 上下文池（单一权威源）：正文池与滚动摘要共享**同一个边界游标**。
 *
 * 机制（"方案 A"）：
 * - 正文池 = `history.jsonl` 的 `[已归档, 总数)` 段，**左边界就是归档游标**
 * - 池子长度达到 `POOL_MAX_MESSAGES` 时，归档最早的 `ARCHIVE_BATCH_MESSAGES` 条进摘要
 * - ⟹ 池子长度在 `[POOL_RESERVED_MESSAGES, POOL_MAX_MESSAGES)` 之间波动
 * - ⟹ **每条消息要么在池子里（原文）、要么在摘要里，不存在第三种状态（无空洞）**
 *
 * 与旧口径（"窗口 = 末尾 N 条，摘要独立攒批"）的关键差别：旧口径下窗口起点由
 * `总数 - N` **算出来**，归档游标是**攒出来**的，两个独立指针之间会留下最多
 * `ARCHIVE_BATCH_MESSAGES - 1` 条"既不在正文、也不在摘要"的真空地带；
 * 本机制把窗口起点直接绑到游标上，从结构上消除该状态。
 *
 * 附带收益：池子左边界每 `ARCHIVE_BATCH_MESSAGES` 条才跳一次，中间各轮
 * `messages` 数组**头部不变、只在尾部追加**，对前缀缓存更友好。
 *
 * 消费方（两处，共用本模块）：
 * - `run-manager.buildPrompt`：`readAll().slice(coveredCount)`，并以上限兜底截断
 * - `summary.maybeArchive`：池子达上限即归档一批
 */

/** 池子上限（条）：达到即归档；正文注入量不会超过它。1 轮正常对话 = 2 条消息，故约 30 轮 */
export const POOL_MAX_MESSAGES = 60;

/** 一次归档的条数（条）：决定正文轮数的波动幅度与摘要调用频率 */
export const ARCHIVE_BATCH_MESSAGES = 20;

/** 归档后池子保留长度（条）= 上限 - 批次；正文注入量在 [该值, 上限) 之间波动 */
export const POOL_RESERVED_MESSAGES = POOL_MAX_MESSAGES - ARCHIVE_BATCH_MESSAGES;
