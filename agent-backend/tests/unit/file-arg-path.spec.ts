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
