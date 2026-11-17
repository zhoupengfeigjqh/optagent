/**
 * 空间名常量（2026-11-17）
 *
 * 三空间的名字由运行端 `agent-backend/src/domain/dirs.ts` 的 `SpaceName` 决定；
 * 浏览器侧**只有一处**需要按名字指认空间：粘贴上传没有"选目录"这一步，默认落点是临时空间。
 * 其余任何地方都必须读 `GET /api/files/workspace` 的响应，不要再添第二份名字。
 *
 * 该常量与后端 `SPACE_TMP` 不一致时不会静默出错：`useUploadPanel.onPasteFiles` 会先用
 * workspace 响应校验该空间是否存在，缺失则提示"文件空间未就绪"，不会把文件传到别处。
 */
export const TMP_SPACE = '临时空间'
