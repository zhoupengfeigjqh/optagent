/**
 * 写操作审计的**目标标注**（任务 2026-09-16）。
 *
 * 统一审计日志由 `server.ts` 的 `onResponse` 钩子产出（一处改动覆盖全部写操作），
 * 但"这次操作的对象是谁"有时只有路由自己知道——典型是技能安装：请求是 multipart，
 * 审计钩子看不到任何字段，技能名要等 ZIP 解析完才确定。
 *
 * 因此给路由一个**极小的标注入口**：路由把已知的标识写进来，钩子负责统一落日志。
 * 这样既不用在每个路由各写一份日志，也不会为了记一个名字而漏掉这类操作。
 *
 * **只允许标注标识**（名称 / 用户号 / 结果开关），MUST NOT 放业务内容
 * （SOUL 正文、文件内容、消息文本）——与 `SC-014` 同一条口径。
 */
export interface AuditAnnotation {
  /** 操作对象（技能名 / 数字人名 / 用户名 / 服务名…） */
  target?: string;
  /** 附加的结构化事实（如 `overwritten: true`）；只放短标量 */
  extra?: Record<string, string | number | boolean>;
}

const marks = new WeakMap<object, AuditAnnotation>();

/** 由路由在成功路径上调用，供审计钩子读取（可多次调用，后者覆盖前者） */
export function markAudit(request: object, annotation: AuditAnnotation): void {
  const previous = marks.get(request);
  const target = annotation.target ?? previous?.target;
  const extra: Record<string, string | number | boolean> = {
    ...previous?.extra,
    ...annotation.extra,
  };
  // `exactOptionalPropertyTypes`：可选字段要么带值要么不出现，不能显式写 undefined
  marks.set(request, {
    ...(target === undefined ? {} : { target }),
    ...(Object.keys(extra).length === 0 ? {} : { extra }),
  });
}

/** 审计钩子读取标注（未标注则为空对象） */
export function auditOf(request: object): AuditAnnotation {
  return marks.get(request) ?? {};
}
