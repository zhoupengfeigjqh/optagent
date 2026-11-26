
export const NEXT_ACTIONS_OPEN = '<next_actions>';
export const NEXT_ACTIONS_CLOSE = '</next_actions>';

/** 尾部缓冲字符上限（超过即视为损坏丢弃；正常卡片 JSON 远小于此） */
const TAIL_MAX_CHARS = 64 * 1024;

export class TailCapture {
  private hold = '';
  private cap = '';
  private scanned = 0;
  private tail: string | null = null;
  private capturing = false;
  private sealed = false;
  private broken = false;

  push(delta: string): string {
    if (this.broken) return delta;
    let buffer = this.hold + delta;
    this.hold = '';
    let out = '';

    for (;;) {
      if (this.capturing) {
        this.cap += buffer;
        const closeIdx = this.cap.indexOf(NEXT_ACTIONS_CLOSE, this.scanned);
        if (closeIdx >= 0) {
          this.tail = this.cap.slice(0, closeIdx);
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

  flush(): string {
    const held = this.hold;
    this.hold = '';
    return held;
  }

  get captured(): string {
    return this.capturing ? this.cap : (this.tail ?? '');
  }

  get overflowed(): boolean {
    return this.broken;
  }

  private suffixPrefixLength(text: string): number {
    const max = Math.min(text.length, NEXT_ACTIONS_OPEN.length - 1);
    for (let len = max; len > 0; len--) {
      if (NEXT_ACTIONS_OPEN.startsWith(text.slice(text.length - len))) return len;
    }
    return 0;
  }
}
