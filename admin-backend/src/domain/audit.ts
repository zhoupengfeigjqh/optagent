export interface AuditAnnotation {
  target?: string;
  extra?: Record<string, string | number | boolean>;
}

const marks = new WeakMap<object, AuditAnnotation>();

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

export function auditOf(request: object): AuditAnnotation {
  return marks.get(request) ?? {};
}
