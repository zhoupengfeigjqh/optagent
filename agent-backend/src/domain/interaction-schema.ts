
interface SchemaLike {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
  enum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  items?: unknown;
  additionalProperties?: unknown;
}

export function validateInteractionArgs(schema: unknown, args: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const errors: string[] = [];
  validateNode(schema as SchemaLike, args, '', errors);
  return errors;
}

function validateNode(schema: SchemaLike, value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push(
        `${labelOf(path)} 须为以下值之一：${schema.enum.map((e) => JSON.stringify(e)).join('、')}`,
      );
      return;
    }
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;
  switch (type) {
    case 'object':
      validateObject(schema, value, path, errors);
      return;
    case 'string':
      if (typeof value !== 'string') errors.push(`${labelOf(path)} 须为字符串`);
      else {
        if (isInt(schema.minLength) && value.length < schema.minLength) {
          errors.push(`${labelOf(path)} 长度不得少于 ${schema.minLength}`);
        }
        if (isInt(schema.maxLength) && value.length > schema.maxLength) {
          errors.push(`${labelOf(path)} 长度不得超过 ${schema.maxLength}`);
        }
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        errors.push(`${labelOf(path)} 须为整数`);
      else checkNumberRange(schema, value, path, errors);
      return;
    case 'number':
      if (typeof value !== 'number') errors.push(`${labelOf(path)} 须为数字`);
      else checkNumberRange(schema, value, path, errors);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${labelOf(path)} 须为布尔值`);
      return;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${labelOf(path)} 须为数组`);
        return;
      }
      if (isSchema(schema.items)) {
        value.forEach((item, i) =>
          validateNode(schema.items as SchemaLike, item, `${path}[${i}]`, errors),
        );
      }
      return;
    default:
      return;
  }
}

function validateObject(schema: SchemaLike, value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${labelOf(path)} 须为对象`);
    return;
  }
  const obj = value as Record<string, unknown>;

  const props = isPlainRecord(schema.properties)
    ? (schema.properties as Record<string, unknown>)
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === 'string')
    : [];
  for (const name of required) {
    if (!(name in obj) || obj[name] === undefined || obj[name] === null || obj[name] === '') {
      errors.push(`${labelOf(joinPath(path, name))} 为必填项`);
    }
  }
  for (const [name, propSchema] of Object.entries(props)) {
    if (name in obj && obj[name] !== undefined && obj[name] !== null && isSchema(propSchema)) {
      validateNode(propSchema as SchemaLike, obj[name], joinPath(path, name), errors);
    }
  }
  if (schema.additionalProperties === false) {
    for (const name of Object.keys(obj)) {
      if (!(name in props)) errors.push(`${labelOf(joinPath(path, name))} 不在允许的属性内`);
    }
  }
}

function checkNumberRange(schema: SchemaLike, value: number, path: string, errors: string[]): void {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push(`${labelOf(path)} 不得小于 ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    errors.push(`${labelOf(path)} 不得大于 ${schema.maximum}`);
  }
}

function labelOf(path: string): string {
  return path === '' ? '入参' : `参数「${path}」`;
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

function isSchema(v: unknown): v is SchemaLike {
  return typeof v === 'object' && v !== null;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      k in (b as Record<string, unknown>) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
