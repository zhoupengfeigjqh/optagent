/**
 * 数字人服务编码生成（028 §17）。
 *
 * 断言的是**契约**而非实现细节：前缀/长度/字符集/去混淆、查重重试、耗尽后的错误语义。
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_CODE_ALPHABET,
  AGENT_CODE_BODY_LENGTH,
  AGENT_CODE_PREFIX,
  generateAgentCode,
  randomAgentCode,
} from '../../src/domain/account/agent-code.js';

/** 固定随机源：总是返回同一个下标 */
const fixed = (index: number) => () => index;

describe('randomAgentCode', () => {
  it('形态为 DH- + 5 位，且全部落在去混淆字符集内', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const code = randomAgentCode(fixed(seed % AGENT_CODE_ALPHABET.length));
      expect(code.startsWith(AGENT_CODE_PREFIX)).toBe(true);
      expect(code.slice(AGENT_CODE_PREFIX.length)).toHaveLength(AGENT_CODE_BODY_LENGTH);
      for (const char of code.slice(AGENT_CODE_PREFIX.length)) {
        expect(AGENT_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('符合编码校验规则（大写字母/数字/连字符，3~32 位）', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const code = randomAgentCode(fixed(seed % AGENT_CODE_ALPHABET.length));
      expect(code).toMatch(/^[A-Z0-9][A-Z0-9-]{1,31}$/);
    }
  });

  it('字符集刻意排除易混字符 I / L / O / U / 0 / 1', () => {
    for (const char of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(AGENT_CODE_ALPHABET).not.toContain(char);
    }
    const code = randomAgentCode(fixed(AGENT_CODE_ALPHABET.length - 1));
    expect(code).toBe(`${AGENT_CODE_PREFIX}ZZZZZ`);
  });

  it('边界下标取到字符集首尾', () => {
    expect(randomAgentCode(fixed(0))).toBe(`${AGENT_CODE_PREFIX}22222`);
  });
});

describe('generateAgentCode', () => {
  it('首个候选未被占用 → 直接用第一个', async () => {
    const code = await generateAgentCode({ isTaken: () => false, random: fixed(0) });
    expect(code).toBe(`${AGENT_CODE_PREFIX}22222`);
  });

  it('候选被占用 → 继续生成直到得到空位（查重是异步的也支持）', async () => {
    const taken = new Set([`${AGENT_CODE_PREFIX}22222`, `${AGENT_CODE_PREFIX}33333`]);
    // 每次生成消耗 5 次随机：第 1 个候选全 2，第 2 个全 3，第 3 个全 4
    let calls = 0;
    const code = await generateAgentCode({
      isTaken: async (candidate) => taken.has(candidate),
      random: (max) => {
        const index = Math.floor(calls / AGENT_CODE_BODY_LENGTH) % max;
        calls += 1;
        return index;
      },
    });
    expect(code).toBe(`${AGENT_CODE_PREFIX}44444`);
  });

  it('连续 attempts 次全被占用 → 抛 INTERNAL_ERROR（不是输入错误）', async () => {
    await expect(
      generateAgentCode({ isTaken: () => true, random: fixed(0), attempts: 3 }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
