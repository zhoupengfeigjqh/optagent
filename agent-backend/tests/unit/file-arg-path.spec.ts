/**
 * 单元测试：`file_args` 取值路径（2026-09-16）
 *
 * 真实对接场景：对方 MCP 服务的入参是**对象数组**
 * `items: [{ businessType, excelFileUrl }]`（`parse_excel_files`），
 * 要铸造的是数组元素里的 `excelFileUrl`。旧的"顶层参数名"表达不了这个位置，
 * 于是引入取值路径。本文件守住**语法边界**：
 * 合法写法必须解析成功；非法写法必须被拒——否则要么是个"配了不生效"的悬空声明，
 * 要么等到运行期才炸（两种都是这次要消灭的形态）。
 */
import { describe, expect, it } from 'vitest';
import { isValidFileArgPath, parseFileArgPath } from '../../src/domain/file-arg-path.js';

describe('file_args 取值路径：解析', () => {
  it('顶层参数名（与旧配置完全等价，向后兼容）', () => {
    expect(parseFileArgPath('image')).toEqual([{ key: 'image', array: false }]);
  });

  it('对象数组的元素字段：items[].excelFileUrl', () => {
    expect(parseFileArgPath('items[].excelFileUrl')).toEqual([
      { key: 'items', array: true },
      { key: 'excelFileUrl', array: false },
    ]);
  });

  it('字符串数组逐元素：files[]', () => {
    expect(parseFileArgPath('files[]')).toEqual([{ key: 'files', array: true }]);
  });

  it('多级嵌套：groups[].files[].url', () => {
    expect(parseFileArgPath('groups[].files[].url')).toEqual([
      { key: 'groups', array: true },
      { key: 'files', array: true },
      { key: 'url', array: false },
    ]);
  });

  it('键名允许中文/下划线/连字符（只禁路径分隔符）', () => {
    expect(parseFileArgPath('文件列表[].下载地址')).toEqual([
      { key: '文件列表', array: true },
      { key: '下载地址', array: false },
    ]);
    expect(isValidFileArgPath('user_id')).toBe(true);
  });

  it('非法写法一律不合法（空段 / 下标 / 重复 [] / 空缺键名）', () => {
    for (const bad of ['', '.', 'a.', '.a', 'a..b', 'a[0]', 'a[][].b', '[].b', 'a[].', '[]']) {
      expect(parseFileArgPath(bad), bad).toBeNull();
      expect(isValidFileArgPath(bad), bad).toBe(false);
    }
  });

  it('非字符串输入不合法（防御：配置来自 JSON，什么类型都可能出现）', () => {
    for (const bad of [undefined, null, 123, ['a'], { key: 'a' }]) {
      expect(isValidFileArgPath(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
