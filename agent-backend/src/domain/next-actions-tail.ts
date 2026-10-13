/**
 * 下一步动作提示（007 修订 · Tail Protocol）：回答流内嵌尾部块的**捕获状态机**。
 *
 * 模型按提示词约定在回答末尾输出 `<next_actions>{...}</next_actions>`；
 * 本状态机挂在 content 增量与 SSE 下发之间，保证：
 *
 * 1. **用户永不可见块内容**：命中开标签后的增量只进尾部缓冲，不再下发；
 * 2. **正文无损**：未命中的增量（含"疑似前缀"误判后冲刷）逐字转发；
 * 3. **首轮块优先**：完整捕获一次后不再开启（双块取首，后续内容按正文转发）；
 * 4. **损坏兜底**：尾部缓冲超过上限视为模型输出损坏，丢弃本轮卡片、
 *    后续内容恢复正常转发（降级不打扰用户，原则九）。
 *
 * 纯内存状态机：无 IO、无时钟，便于单测穷举边界（跨增量拆分 / 误前缀 / 块后正文）。
 */

/** 开标签：命中即进入捕获 */
export const NEXT_ACTIONS_OPEN = '<next_actions>';
/** 闭标签：命中即封存尾部并恢复转发 */
export const NEXT_ACTIONS_CLOSE = '</next_actions>';

/** 尾部缓冲字符上限（超过即视为损坏丢弃；正常卡片 JSON 远小于此） */
const TAIL_MAX_CHARS = 64 * 1024;

export class TailCapture {
  /** 疑似开标签前缀的暂扣字符（未确认前不下发，确认误判后冲刷为正文） */
  private hold = '';
  /** 捕获中的原始累积（开标签之后、闭标签判定为止的全部字符） */
  private cap = '';
  /** `cap` 中已排查过闭标签的右边界（闭标签可跨增量拆分，回溯重叠区） */
  private scanned = 0;
  /** 已封存的尾部原文（开标签与闭标签之间）；`null` = 本轮未完整闭合 */
  private tail: string | null = null;
  /** 是否正在捕获（已见开标签、未见闭标签） */
  private capturing = false;
  /** 是否已完整捕获过一轮（双块取首） */
  private sealed = false;
  /** 损坏标志：缓冲超限后停用捕获 */
  private broken = false;

  /**
   * 处理一个 content 增量，返回**应当作为正文下发**的部分（可为空串）。
   * 未下发的部分要么进入捕获缓冲，要么暂扣等待后续增量确认。
   */
  push(delta: string): string {
    if (this.broken) return delta;
    let buffer = this.hold + delta;
    this.hold = '';
    let out = '';

    for (;;) {
      if (this.capturing) {
        this.cap += buffer;
        // 从上次排查边界继续找闭标签（边界回退一个重叠区，容忍闭标签跨增量拆分）
        const closeIdx = this.cap.indexOf(NEXT_ACTIONS_CLOSE, this.scanned);
        if (closeIdx >= 0) {
          this.tail = this.cap.slice(0, closeIdx);
          // 闭标签后的内容恢复正常转发（容错模型在块后继续说话）
          buffer = this.cap.slice(closeIdx + NEXT_ACTIONS_CLOSE.length);
          this.cap = '';
          this.scanned = 0;
          this.capturing = false;
          this.sealed = true;
          continue;
        }
        this.scanned = Math.max(0, this.cap.length - NEXT_ACTIONS_CLOSE.length + 1);
        if (this.cap.length > TAIL_MAX_CHARS) {
          // 损坏兜底：丢弃卡片，后续正文恢复转发（不再识别，避免半截标签再次误触发）
          this.cap = '';
          this.scanned = 0;
          this.capturing = false;
          this.broken = true;
        }
        return out;
      }

      if (this.sealed) {
        // 首个块已封存：之后的一切（含第二个块）都按正文转发
        return out + buffer;
      }

      const openIdx = buffer.indexOf(NEXT_ACTIONS_OPEN);
      if (openIdx >= 0) {
        out += buffer.slice(0, openIdx);
        buffer = buffer.slice(openIdx + NEXT_ACTIONS_OPEN.length);
        this.capturing = true;
        this.cap = '';
        this.scanned = 0;
        continue;
      }

      // 无完整开标签：末尾若与开标签前缀吻合则暂扣，其余转发
      const holdLen = this.suffixPrefixLength(buffer);
      if (holdLen > 0) {
        out += buffer.slice(0, buffer.length - holdLen);
        this.hold = buffer.slice(buffer.length - holdLen);
      } else {
        out += buffer;
      }
      return out;
    }
  }

  /** 流结束时冲刷暂扣：疑似前缀确认为普通正文（返回应补发的部分） */
  flush(): string {
    const held = this.hold;
    this.hold = '';
    return held;
  }

  /** 捕获到的尾部原文（未出现开标签 / 损坏丢弃时为空串；捕获中 = 已累积的半截原文） */
  get captured(): string {
    return this.capturing ? this.cap : (this.tail ?? '');
  }

  /** 是否发生过"缓冲超限丢弃"（供上层告警定位） */
  get overflowed(): boolean {
    return this.broken;
  }

  /** buffer 末尾与开标签前缀的最长吻合长度（不含完整命中，完整命中已在上层处理） */
  private suffixPrefixLength(text: string): number {
    const max = Math.min(text.length, NEXT_ACTIONS_OPEN.length - 1);
    for (let len = max; len > 0; len--) {
      if (NEXT_ACTIONS_OPEN.startsWith(text.slice(text.length - len))) return len;
    }
    return 0;
  }
}
