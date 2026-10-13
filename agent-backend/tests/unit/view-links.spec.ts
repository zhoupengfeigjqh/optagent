/**
 * 单元测试：工具结果里的视图链接抽取（2026-10-10，`TR-44`）
 *
 * 守住五件事：
 * 1. **只按字段名判定** —— `viewUrl` 大小写不敏感、任意层级生效；不看值像不像地址
 * 2. **同层配对** —— `viewUrlName` 只与同一对象里的 `viewUrl` 配对，跨层配不上
 * 3. **确定性去重** —— 按地址原值去重，名称取首个非空值
 * 4. **形态卫生** —— 非字符串/空白/超长/控制字符被挡；名称脏只丢名字、不丢地址
 * 5. **失败即 `undefined`** —— 非 JSON / 标量 / 超解析上限 / 没命中 → 不写字段（行为与改动前一致）
 *
 * 刻意**不测** scheme 合法性（`//host/…`、无前导 `/`、`javascript:`）：
 * 那是前端 `resolveViewUrl()` 的唯一职责（`TR-42`），后端只做搬运。
 */
import { describe, expect, it } from 'vitest';
import {
  VIEW_LINK_MAX_DEPTH,
  VIEW_LINK_MAX_ITEMS,
  VIEW_LINK_PARSE_MAX_CHARS,
  VIEW_URL_MAX_CHARS,
  extractViewLinks,
} from '../../src/domain/view-links.js';

/** 把 `viewUrl` 包进 `levels` 层 `{ a: … }`（即 `viewUrl` 位于深度 `levels`）。 */
function nestJson(levels: number): unknown {
  let node: unknown = { viewUrl: '/a/b' };
  for (let i = 0; i < levels; i++) node = { a: node };
  return node;
}

describe('extractViewLinks —— 命中与配对', () => {
  it('顶层对象里的 viewUrl：收起一条，且不带名字', () => {
    const links = extractViewLinks(
      JSON.stringify({ status: 'success', viewUrl: '/datasource/abc/xlsx' }),
    );

    expect(links).toEqual([{ url: '/datasource/abc/xlsx' }]);
  });

  it('同层的 viewUrlName 与地址配对', () => {
    const links = extractViewLinks(
      JSON.stringify({
        status: 'success',
        viewUrl: '/datasource/plan/ws1/xlsx',
        viewUrlName: '一车间产能明细',
      }),
    );

    expect(links).toEqual([{ url: '/datasource/plan/ws1/xlsx', name: '一车间产能明细' }]);
  });

  it('任意层级都生效，顺序 = 出现顺序（深度优先）', () => {
    const links = extractViewLinks(
      JSON.stringify({
        first: { viewUrl: '/a', viewUrlName: 'A' },
        second: { viewUrl: '/b' },
      }),
    );

    expect(links).toEqual([{ url: '/a', name: 'A' }, { url: '/b' }]);
  });

  it('对象数组：每行的 viewUrl 各收一条（表格单元格里的也能），顺序按行', () => {
    const links = extractViewLinks(
      JSON.stringify([
        { orderNo: 'WO-1', viewUrl: '/a' },
        { orderNo: 'WO-2', viewUrl: '/b', viewUrlName: 'B 明细' },
      ]),
    );

    expect(links).toEqual([{ url: '/a' }, { url: '/b', name: 'B 明细' }]);
  });

  it('字段名大小写不敏感、忽略首尾空白', () => {
    const links = extractViewLinks(
      JSON.stringify({ ViewUrl: '/a', VIEWURLNAME: 'A 明细' }),
    );

    expect(links).toEqual([{ url: '/a', name: 'A 明细' }]);
  });

  it('数组套数组：继续向内遍历', () => {
    const links = extractViewLinks(JSON.stringify([[{ viewUrl: '/deep' }]]));

    expect(links).toEqual([{ url: '/deep' }]);
  });
});

describe('extractViewLinks —— 去重与命名', () => {
  it('完全相同的地址去重（含首尾空白归一）', () => {
    const links = extractViewLinks(
      JSON.stringify([{ viewUrl: '/a' }, { viewUrl: '/a' }, { viewUrl: '  /a  ' }]),
    );

    expect(links).toEqual([{ url: '/a' }]);
  });

  it('同一地址：首次没给名字、后面给了 → 用后面那个名字', () => {
    const links = extractViewLinks(
      JSON.stringify([{ viewUrl: '/a' }, { viewUrl: '/a', viewUrlName: 'A 明细' }]),
    );

    expect(links).toEqual([{ url: '/a', name: 'A 明细' }]);
  });

  it('同一地址：首次已给名字 → 保留首个名字（后给的不覆盖）', () => {
    const links = extractViewLinks(
      JSON.stringify([
        { viewUrl: '/a', viewUrlName: '首个名字' },
        { viewUrl: '/a', viewUrlName: '后给的名字' },
      ]),
    );

    expect(links).toEqual([{ url: '/a', name: '首个名字' }]);
  });

  it('名称与地址**跨层**不配对：有地址、无名字', () => {
    const links = extractViewLinks(
      JSON.stringify({ outer: { inner: { viewUrl: '/a' } }, viewUrlName: '外层名字' }),
    );

    expect(links).toEqual([{ url: '/a' }]);
  });
});

describe('extractViewLinks —— 形态卫生', () => {
  it('非字符串值（数字 / 对象 / 数组 / null）一律忽略', () => {
    expect(extractViewLinks(JSON.stringify({ viewUrl: 123 }))).toBeUndefined();
    expect(extractViewLinks(JSON.stringify({ viewUrl: { href: '/a' } }))).toBeUndefined();
    expect(extractViewLinks(JSON.stringify({ viewUrl: ['/a'] }))).toBeUndefined();
    expect(extractViewLinks(JSON.stringify({ viewUrl: null }))).toBeUndefined();
  });

  it('空白地址忽略；超长地址忽略（视为脏数据）', () => {
    expect(extractViewLinks(JSON.stringify({ viewUrl: '   ' }))).toBeUndefined();
    expect(
      extractViewLinks(JSON.stringify({ viewUrl: '/' + 'x'.repeat(VIEW_URL_MAX_CHARS) })),
    ).toBeUndefined();
  });

  it('地址含控制字符或反斜杠 → 忽略该条（常见的绕过手法）', () => {
    expect(extractViewLinks(JSON.stringify({ viewUrl: '/a\tb' }))).toBeUndefined();
    expect(extractViewLinks(JSON.stringify({ viewUrl: '/a\\b' }))).toBeUndefined();
    expect(extractViewLinks(JSON.stringify({ viewUrl: '/a\u0000b' }))).toBeUndefined();
  });

  it('名称脏（超长 / 控制字符）→ 只丢名字，地址保留', () => {
    const tooLong = extractViewLinks(
      JSON.stringify({ viewUrl: '/a', viewUrlName: '名'.repeat(121) }),
    );
    const dirty = extractViewLinks(JSON.stringify({ viewUrl: '/a', viewUrlName: '有\t制表符' }));

    expect(tooLong).toEqual([{ url: '/a' }]);
    expect(dirty).toEqual([{ url: '/a' }]);
  });

  it('名称不是字符串 → 视同没给名字', () => {
    expect(extractViewLinks(JSON.stringify({ viewUrl: '/a', viewUrlName: 42 }))).toEqual([
      { url: '/a' },
    ]);
  });
});

describe('extractViewLinks —— 边界与降级', () => {
  it('非 JSON → undefined（不抛错）', () => {
    expect(extractViewLinks('车间,计划量\n冲压,1200')).toBeUndefined();
    expect(extractViewLinks('')).toBeUndefined();
  });

  it('是 JSON 但只是标量 → undefined', () => {
    expect(extractViewLinks('"just a string"')).toBeUndefined();
    expect(extractViewLinks('123')).toBeUndefined();
    expect(extractViewLinks('null')).toBeUndefined();
  });

  it(`超过 ${VIEW_LINK_PARSE_MAX_CHARS} 字符不解析（与前端结构化展示同判据）`, () => {
    const huge = JSON.stringify({ viewUrl: '/a', pad: 'x'.repeat(VIEW_LINK_PARSE_MAX_CHARS) });

    expect(huge.length).toBeGreaterThan(VIEW_LINK_PARSE_MAX_CHARS);
    expect(extractViewLinks(huge)).toBeUndefined();
  });

  it('没有 viewUrl（普通对象 / 纯数组）→ undefined', () => {
    expect(extractViewLinks(JSON.stringify({ status: 'success', message: '完成' }))).toBeUndefined();
    expect(extractViewLinks(JSON.stringify([1, 2, 3]))).toBeUndefined();
  });

  it(`深度超过 ${VIEW_LINK_MAX_DEPTH} 不抽取；恰好在深度上限内则抽取`, () => {
    expect(extractViewLinks(JSON.stringify(nestJson(VIEW_LINK_MAX_DEPTH)))).toEqual([
      { url: '/a/b' },
    ]);
    expect(extractViewLinks(JSON.stringify(nestJson(VIEW_LINK_MAX_DEPTH + 1)))).toBeUndefined();
  });

  it(`条数上限 ${VIEW_LINK_MAX_ITEMS}：超出不再收新地址，但可给已有地址补名字`, () => {
    const many = Array.from({ length: VIEW_LINK_MAX_ITEMS + 10 }, (_, i) => ({
      viewUrl: `/ds/${i}`,
    }));
    // 末尾再出现一次首条地址，且这次带名字
    many.push({ viewUrl: '/ds/0', viewUrlName: '第 0 条明细' });

    const links = extractViewLinks(JSON.stringify(many));

    expect(links).toHaveLength(VIEW_LINK_MAX_ITEMS);
    expect(links?.[0]).toEqual({ url: '/ds/0', name: '第 0 条明细' });
    expect(links?.[VIEW_LINK_MAX_ITEMS - 1]).toEqual({ url: `/ds/${VIEW_LINK_MAX_ITEMS - 1}` });
  });
});
