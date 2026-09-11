/**
 * calculator 工具（T038）：安全表达式求值。
 *
 * 自写递归下降解析器（npm 环境装不了 expr-eval，且零依赖更可控），
 * 严禁 eval/Function。支持：+ - * / % ^（幂）、括号、一元负号、
 * 函数 sqrt/abs/round/floor/ceil/min/max/pow，常量 pi/e。
 * 任何非表达式输入（标识符、分号、赋值等）一律拒绝。
 */

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export class CalculatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculatorError';
  }
}

interface Token {
  kind: 'num' | 'op' | 'ident' | 'lparen' | 'rparen' | 'comma';
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new CalculatorError(`无法解析的数字，位置 ${i + 1}`);
      tokens.push({ kind: 'num', value: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ kind: 'ident', value: m[0] });
      i += m[0].length;
      continue;
    }
    if ('+-*/%^'.includes(c)) tokens.push({ kind: 'op', value: c });
    else if (c === '(') tokens.push({ kind: 'lparen', value: c });
    else if (c === ')') tokens.push({ kind: 'rparen', value: c });
    else if (c === ',') tokens.push({ kind: 'comma', value: c });
    else
      throw new CalculatorError(`表达式含不允许的字符 "${c}"（仅支持数字与 + - * / % ^ 及函数）`);
    i++;
  }
  return tokens;
}

/** 递归下降求值器：expr → term → factor → unary → power → atom */
class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const v = this.expr();
    if (this.pos < this.tokens.length) {
      throw new CalculatorError(`表达式在 "${this.tokens[this.pos]!.value}" 处有多余内容`);
    }
    return v;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private eatOp(op: string): boolean {
    const t = this.peek();
    if (t?.kind === 'op' && t.value === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expr(): number {
    let v = this.term();
    for (;;) {
      if (this.eatOp('+')) v += this.term();
      else if (this.eatOp('-')) v -= this.term();
      else return v;
    }
  }
  private term(): number {
    let v = this.unary();
    for (;;) {
      if (this.eatOp('*')) v *= this.unary();
      else if (this.eatOp('/')) {
        const d = this.unary();
        if (d === 0) throw new CalculatorError('除数为 0');
        v /= d;
      } else if (this.eatOp('%')) v %= this.unary();
      else return v;
    }
  }
  private unary(): number {
    if (this.eatOp('-')) return -this.unary();
    if (this.eatOp('+')) return this.unary();
    return this.power();
  }
  private power(): number {
    const base = this.atom();
    if (this.eatOp('^')) return Math.pow(base, this.unary()); // 右结合
    return base;
  }
  private atom(): number {
    const t = this.peek();
    if (!t) throw new CalculatorError('表达式不完整');
    if (t.kind === 'num') {
      this.pos++;
      return Number(t.value);
    }
    if (t.kind === 'lparen') {
      this.pos++;
      const v = this.expr();
      if (this.peek()?.kind !== 'rparen') throw new CalculatorError('缺少右括号');
      this.pos++;
      return v;
    }
    if (t.kind === 'ident') {
      this.pos++;
      if (t.value in CONSTANTS) return CONSTANTS[t.value]!;
      if (this.peek()?.kind === 'lparen') {
        const fn = FUNCTIONS[t.value];
        if (!fn)
          throw new CalculatorError(
            `未知函数 "${t.value}"（支持 ${Object.keys(FUNCTIONS).join('/')}）`,
          );
        this.pos++;
        const args: number[] = [];
        if (this.peek()?.kind !== 'rparen') {
          for (;;) {
            args.push(this.expr());
            if (this.peek()?.kind === 'comma') {
              this.pos++;
              continue;
            }
            break;
          }
        }
        if (this.peek()?.kind !== 'rparen') throw new CalculatorError(`函数 ${t.value} 缺少右括号`);
        this.pos++;
        if (args.length === 0) throw new CalculatorError(`函数 ${t.value} 缺少参数`);
        return fn(...args);
      }
      throw new CalculatorError(`未知标识符 "${t.value}"，表达式只允许数字、运算符与支持的函数`);
    }
    throw new CalculatorError(`表达式在 "${t.value}" 处不符合语法`);
  }
}

export function evaluateExpression(src: string): number {
  if (!src.trim()) throw new CalculatorError('表达式为空');
  if (src.length > 500) throw new CalculatorError('表达式过长（上限 500 字符）');
  const result = new Parser(tokenize(src)).parse();
  if (!Number.isFinite(result)) throw new CalculatorError('计算结果不是有限数值');
  return result;
}

/** calculator 工具入口：返回交给模型的文本 */
export function calcTool(src: string): string {
  const v = evaluateExpression(src);
  return `${src} = ${Number.isInteger(v) ? v : Number(v.toPrecision(12))}`;
}
