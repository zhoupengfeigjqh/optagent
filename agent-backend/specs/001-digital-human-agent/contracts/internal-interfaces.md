# Contracts: 内部接口（domain 定义，infra 实现）

> 这些接口是需求"可替换组件/扩展点"的结构化落点：业务代码只依赖这里的签名，
> 不 import pi / Fastify / better-sqlite3。签名为 TypeScript 描述。

## 1. LlmProvider（LLM 提供方抽象，需求 2.8）

```typescript
interface LlmProvider {
  // 流式对话；thinking 开关为请求级参数
  streamChat(req: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    tools: ToolSpec[];
    thinking: boolean;
    signal: AbortSignal; // stop / 关机中断
  }): AsyncIterable<LlmEvent>; // thinking_delta | content_delta | done(usage) | error
}
```

- **本期实现**: `infra/llm/pi-ai-provider.ts`（pi-ai deepseek provider，
  `reasoning_content` → thinking_delta 原生支持）。
- **扩展点**: 日后 Qwen/GPT 各加一个实现类；按数字人/按请求切模型时
  在 agent-instance 选择实现，业务层不变。

## 2. PoolStore（实例池存储抽象，需求"可扩展性"）

```typescript
interface PoolStore {
  get(key: PoolKey): AgentInstance | undefined;
  put(instance: AgentInstance): void;
  remove(key: PoolKey): void;
  evictIdle(maxIdleMs: number): PoolKey[]; // 仅淘汰无活跃 run 的实例
  lruEvictOne(): PoolKey | undefined; // 仅空闲实例；无则返回 undefined
  size(): number;
  list(): AgentInstance[]; // 监控接口用
}
```

- **本期实现**: 进程内 Map + 时间戳。
- **扩展点**: 分布式形态替换为 Redis 会话索引 + 粘性路由，业务代码不感知。

## 3. FileAccess（文件访问代理层，FR-022 核心安全策略）

```typescript
interface FileAccess {
  read(relPath: string, opts?: { offset?: number; limit?: number }): Promise<string>;
  write(threadId: string, filename: string, content: string): Promise<string>; // 返回实际落盘路径
  list(dir: string): Promise<FileEntry[]>;
  grep(pattern: string, dir?: string): Promise<GrepMatch[]>;
}
```

- 内部统一做：**路径规范化 → 拒绝穿越（`..`/绝对路径）→ 目录白名单**；
  写操作仅限 `临时空间/` 且强制 `{thread_id}_` 前缀，违规抛 `PermissionError`。
  （**2026-09-13 修订**）读白名单为三个空间：`数据准备/`（首段之后 MUST 是 scenario 中
  已存在于磁盘的二级目录）、`共享空间/`、`临时空间/`。
- 6 个内置工具全部经此代理；`read` 内部按扩展名分派 xlsx/pdf 解析；
  读临时空间文件时用 `fs.utimes` 刷新访问时间（供 7 天清理判断）。
- `grep` 的可读目录经 `expandSpaces()` 展开（数据准备展开为其下已存在的各二级目录），
  使数据准备子目录内文件同样可被检索。
- **场景配置**：`loadScenario(root, userId)` 读 `users/{userId}/scenario.json`，
  按 mtime 缓存并对缺失/损坏抛 `ScenarioNotConfiguredError`（业务侧映射为
  503 `SCENARIO_NOT_CONFIGURED`）；`parseSpaceDir(root, userId, dir)` 负责把
  `dir` 相对路径解析为 `{space, sub?, relPath}`，越权/不合法抛 `DirValidationError`（400/403）。
- **`grep` 仅作用文本格式**（.csv/.txt/.json），跳过 .xlsx/.pdf 二进制
  并在结果中注明跳过数量。

## 4. UsageStore（Token 用量）

```typescript
interface UsageStore {
  record(entry: Omit<UsageRecord, 'id'>): void; // 失败记日志不抛出
  summary(filter: {
    userId: string;
    threadId?: string;
    agentName?: string;
    from?: string;
    to?: string;
  }): UsageSummary;
}
```

- **本期实现**: better-sqlite3 全局单库（写同步微秒级，读走索引）。

## 5. McpManager（MCP 连接管理）

```typescript
interface McpManager {
  connectAll(configs: McpServerConfig[]): Promise<McpConnectResult>;
  // 单个建连失败不抛出：result.unavailable 标记，实例降级就绪
  callTool(server: string, tool: string, args: unknown): Promise<unknown>;
  // 30s 超时 + 重试 1 次；server 在 unavailable 列表 → 抛 McpUnavailableError
  closeAll(): Promise<void>; // 实例回收/关机
}
```

## 6. Scheduler（后台任务注册）

```typescript
interface Scheduler {
  every(intervalMs: number, task: () => Promise<void>, name: string): void;
  stopAll(): void; // 优雅关闭
}
```

## 依赖方向

```
routes ──► domain（AgentPool / RunManager / FileAccess / ThreadStore …）
              ▲ 接口定义在此
              │ 实现注入
           infra（pi-ai-provider / PoolStore 内存实现 / usage-db / mcp-manager）
```
