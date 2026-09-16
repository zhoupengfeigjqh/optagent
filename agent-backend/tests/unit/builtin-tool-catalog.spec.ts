/**
 * 单元测试：内置工具目录（T040，`plan.md` R1）
 *
 * **核心不变式**：用现状的运行期取值渲染模板后，结果 MUST 与改造前
 * `buildBuiltinTools` 产出的 `description` / `parameters` **逐字相等**。
 * 即：R1 只改变元数据的组织方式，**不改变任何对模型可见的文本**。
 *
 * 断言以**字面量**（golden 字符串）写出，而不是"再算一遍同样的拼接"——
 * 后者会与被测实现犯同一个错误而检测不出漂移。
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOL_CATALOG,
  builtinToolNames,
  findBuiltinTool,
  listBuiltinTools,
  renderDeep,
  renderTemplate,
  type TemplateValues,
} from '../../src/domain/builtin-tool-catalog.js';

/** 现状的一组运行期取值（取真实形态：中文目录名 + thread_id） */
const DIRS = ['数据准备/生产计划', '共享空间', '临时空间'];
const THREAD_ID = 'th_abc123';
const values: Partial<TemplateValues> = {
  可用目录: DIRS.join('、'),
  示例路径: `${DIRS[0]}/示例.csv`,
  首个目录: DIRS[0],
  会话标识: THREAD_ID,
  临时空间: '临时空间',
};

describe('BUILTIN_TOOL_CATALOG', () => {
  it('共 5 项，名称与顺序与改造前一致', () => {
    expect(BUILTIN_TOOL_CATALOG.map((t) => t.name)).toEqual([
      'read_file',
      'write_file',
      'list_dir',
      'grep_files',
      'calculator',
    ]);
    expect(builtinToolNames()).toHaveLength(5);
  });

  it('writable 标记：仅 write_file 为 true（FR-011）', () => {
    const writable = BUILTIN_TOOL_CATALOG.filter((t) => t.writable).map((t) => t.name);
    expect(writable).toEqual(['write_file']);
  });

  it('每项的 description_template 与 parameters 非空', () => {
    for (const tool of BUILTIN_TOOL_CATALOG) {
      expect(tool.description_template.length).toBeGreaterThan(0);
      expect(tool.label.length).toBeGreaterThan(0);
      expect(Object.keys(tool.parameters).length).toBeGreaterThan(0);
    }
  });

  it('listBuiltinTools 返回全部条目；findBuiltinTool 命中/未命中', () => {
    expect(listBuiltinTools()).toHaveLength(5);
    expect(findBuiltinTool('calculator')?.label).toBe('计算器');
    expect(findBuiltinTool('nope')).toBeUndefined();
  });
});

describe('renderTemplate', () => {
  it('只替换已登记的占位符，未登记的原样保留', () => {
    expect(renderTemplate('目录：{可用目录}；文件：{filename}', values)).toBe(
      `目录：${DIRS.join('、')}；文件：{filename}`,
    );
  });

  it('值缺省时保留占位符（不产生 "undefined"）', () => {
    expect(renderTemplate('{会话标识}', {})).toBe('{会话标识}');
  });

  it('同类占位符多次出现全部替换', () => {
    expect(renderTemplate('{临时空间}/{临时空间}', values)).toBe('临时空间/临时空间');
  });
});

describe('不变式：渲染结果与改造前逐字相等', () => {
  const rendered = new Map(
    BUILTIN_TOOL_CATALOG.map((t) => [
      t.name,
      {
        description: renderTemplate(t.description_template, values),
        parameters: renderDeep(t.parameters, values) as Record<string, never>,
      },
    ]),
  );

  it('read_file 的说明与入参', () => {
    expect(rendered.get('read_file')?.description).toBe(
      '读取用户空间（数据准备/共享空间/临时空间）下的文件内容。支持 .csv/.xlsx/.txt/.json/.pdf/.md/.log；' +
        'xlsx 自动转 CSV，pdf 提取文本层。大文件返回截断内容，可用 offset 继续分段读取。' +
        `参数 path 为相对空间的路径，如 "${DIRS[0]}/示例.csv"。`,
    );
    expect(rendered.get('read_file')?.parameters).toEqual({
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: `相对路径，如 "${DIRS[0]}/示例.csv"` },
        offset: { type: 'number', description: '字节偏移（续读截断内容时用）' },
        limit: { type: 'number', description: '本次最多返回字节数' },
      },
    });
  });

  it('write_file 的说明与入参（含字面量 {filename} 不被替换）', () => {
    expect(rendered.get('write_file')?.description).toBe(
      `把内容写入临时空间，文件名会自动要求以 "${THREAD_ID}_" 开头。` +
        '数据准备与共享空间为只读，写入会被拒绝。写成功后可用路径 临时空间/{filename} 告知用户下载。',
    );
    expect(rendered.get('write_file')?.parameters).toEqual({
      type: 'object',
      required: ['filename', 'content'],
      properties: {
        filename: { type: 'string', description: `文件名，必须以 ${THREAD_ID}_ 开头` },
        content: { type: 'string', description: '文件内容（utf8 文本）' },
      },
    });
  });

  it('list_dir 的说明与入参', () => {
    expect(rendered.get('list_dir')?.description).toBe(
      `列出指定目录的文件（名称/大小/更新时间）。目录限：${DIRS.join('、')}。`,
    );
    expect(rendered.get('list_dir')?.parameters).toEqual({
      type: 'object',
      required: ['dir'],
      properties: { dir: { type: 'string', description: `目录路径，如 "${DIRS[0]}"` } },
    });
  });

  it('grep_files 的说明与入参', () => {
    expect(rendered.get('grep_files')?.description).toBe(
      '在文本类文件（.csv/.txt/.json/.md/.log）中按正则检索关键词；xlsx/pdf 会被跳过（请改用 read_file）。' +
        '可指定目录，缺省检索全部开放目录。',
    );
    expect(rendered.get('grep_files')?.parameters).toEqual({
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: '检索词或正则表达式' },
        dir: { type: 'string', description: '限定目录（可选）' },
      },
    });
  });

  it('calculator 的说明与入参', () => {
    expect(rendered.get('calculator')?.description).toBe(
      '计算数学表达式。支持 + - * / % ^、括号、sqrt/abs/round/floor/ceil/min/max/pow 函数与常量 pi/e。',
    );
    expect(rendered.get('calculator')?.parameters).toEqual({
      type: 'object',
      required: ['expression'],
      properties: { expression: { type: 'string', description: '数学表达式，如 "(1+2)*3"' } },
    });
  });

  it('可用目录为空时回退默认示例（与改造前的 ?? 兜底一致）', () => {
    const empty: Partial<TemplateValues> = {
      可用目录: '',
      示例路径: '共享空间/示例.csv',
      首个目录: '共享空间',
      会话标识: THREAD_ID,
    };
    const listDir = findBuiltinTool('list_dir')!;
    expect(renderTemplate(listDir.description_template, empty)).toBe(
      '列出指定目录的文件（名称/大小/更新时间）。目录限：。',
    );
    expect(renderDeep(listDir.parameters, empty)).toEqual({
      type: 'object',
      required: ['dir'],
      properties: { dir: { type: 'string', description: '目录路径，如 "共享空间"' } },
    });
  });
});

describe('renderDeep', () => {
  it('递归渲染对象与数组中的字符串，非字符串原样保留', () => {
    expect(
      renderDeep({ a: '{会话标识}', b: ['{临时空间}'], c: 1, d: true, e: null }, values),
    ).toEqual({ a: THREAD_ID, b: ['临时空间'], c: 1, d: true, e: null });
  });
});
