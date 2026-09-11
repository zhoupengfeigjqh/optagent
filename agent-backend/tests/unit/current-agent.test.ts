import { describe, expect, it } from 'vitest';
import { CurrentAgentStore } from '../../src/domain/current-agent';

describe('CurrentAgentStore', () => {
  it('select 后 current 可查', () => {
    const s = new CurrentAgentStore();
    s.select('admin', 'helper');
    expect(s.current('admin')).toEqual({ userId: 'admin', agentName: 'helper' });
  });

  it('重复 select 同一数字人幂等', () => {
    const s = new CurrentAgentStore();
    s.select('admin', 'helper');
    expect(() => s.select('admin', 'helper')).not.toThrow();
  });

  it('选中他人直接覆盖（无需先 exit）', () => {
    const s = new CurrentAgentStore();
    s.select('admin', 'a');
    expect(() => s.select('admin', 'b')).not.toThrow();
    expect(s.current('admin')).toEqual({ userId: 'admin', agentName: 'b' });
  });

  it('exit 幂等；未选中时 current 为 undefined', () => {
    const s = new CurrentAgentStore();
    expect(() => s.exit('admin')).not.toThrow();
    expect(s.current('admin')).toBeUndefined();
  });

  it('多用户互不影响', () => {
    const s = new CurrentAgentStore();
    s.select('admin', 'a');
    s.select('bob', 'b');
    expect(s.current('admin')!.agentName).toBe('a');
    expect(s.current('bob')!.agentName).toBe('b');
  });
});
