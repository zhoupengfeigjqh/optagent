/**
 * 与"跨服务契约 / 工具语义"绑定的硬上限（2026-11-26 由 env 降为常量）。
 *
 * 为什么不做成配置：
 * - `UPLOAD_MAX_MB`：同一数值同时写在 `admin-backend`、`gateway`（nginx `client_max_body_size`）
 *   与前端校验里，单侧可调等于让某个入口先被 413 拦下，用户看到的是"上传时好时坏"；
 * - `PREVIEW_MAX_MB`：与上传同口径的防御性上限，调大只是让服务端多读一份大文件进内存；
 * - `READ_TRUNCATE_KB`：`read_file` 的**返回语义**（超限即截断并提示分页），属于工具行为，
 *   配置化会让同一句话在不同机器上得到不同结果，回放不可复现。
 *
 * 要改这三个值 = 改规格：四侧（agent-backend / admin-backend / gateway / frontend）同步修改。
 */
export const UPLOAD_MAX_MB = 5;
export const PREVIEW_MAX_MB = 5;
export const READ_TRUNCATE_KB = 128;
