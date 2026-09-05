/**
 * 公共字符串常量 —— 生命周期状态、角色、控制动作、协议消息类型、枚举与
 * 命名空间前缀。
 *
 * 所有运行时使用的字符串字面量集中在此一份值，类型定义（src/core/types.ts
 * 等）通过 `(typeof X)[keyof typeof X]` 从这些常量派生，比较/switch 处引用
 * 同一对象成员。这样既能消除散落在各文件里的重复字符串（避免大小写不统一
 * 或笔误），又保证类型与值永不错位。
 *
 * ## 使用约定
 *
 * - **新增或修改字符串字面量时，先到这里查找/增补，不要在业务文件里直接写
 *   魔法字符串。** 扫描残留字面量：`rg "'(['a-z]+)'" src/`。
 * - **只用于类型位置的常量**（如 `PERSISTENCE_OPERATION`）在调用方用
 *   `import type`；**在运行时比较/构造中使用的**（如 `WORKER_STATUS.ERROR`、
 *   `TRACE_EVENT_TYPE.LIFECYCLE`）必须用值导入，否则会报 "cannot be used as
 *   a value because it was imported using 'import type'"。
 * - **值派生类型**：`export type WorkerStatus = (typeof WORKER_STATUS)[keyof
 *   typeof WORKER_STATUS]`。这样新增枚举分支时类型自动收窄，编译器会指出
 *   每个遗漏的 switch 分支。
 * - 分组的顺序（状态 / 角色 / 后端 / 消息类型 / 枚举 / 前缀）保持稳定，方便
 *   维护者一眼定位。
 */

// ---- 生命周期状态 / 角色 / 可见性 ----
export const WORKER_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;

export const WORKER_ROLE = {
  ACTIVE: 'active',
  STANDBY: 'standby',
} as const;

export const TAB_VISIBILITY = {
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
} as const;

// ---- Worker 后端模式与解析结果（WorkerMode / WorkerBackend）----
export const WORKER_MODE = {
  DEDICATED: 'dedicated',
  SHARED: 'shared',
  AUTO: 'auto',
} as const;

export const WORKER_BACKEND = {
  DEDICATED: 'dedicated',
  SHARED: 'shared',
  LOCAL: 'local',
} as const;

// ---- 存储事件通道回退 ----
export const CHANNEL_FALLBACK = {
  NONE: 'none',
  STORAGE_EVENT: 'storage-event',
} as const;

// ---- Worker / MessagePort / BroadcastChannel 的 EventTarget 事件名判别 ----
// MessageEvent.type（'message' / 'messageerror'）与 Worker 上的 'error' 事件名，
// 用于环境适配器接口签名与测试替身的 addEventListener 真假分支。
export const EVENT_TYPE = {
  MESSAGE: 'message',
  MESSAGEERROR: 'messageerror',
  ERROR: 'error',
} as const;

// ---- 控制平面动作（WorkerControlAction）----
export const CONTROL_ACTION = {
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
  PUBLISH: 'PUBLISH',
} as const;

// ---- BroadcastChannel 集群消息类型 ----
export const CLUSTER_MESSAGE_TYPE = {
  CONTROL: 'CONTROL',
  EVENT: 'EVENT',
  REGISTRY: 'REGISTRY',
  ROUTE_RELEASED: 'ROUTE_RELEASED',
} as const;

// ---- 命名空间前缀与事件名 ----
export const DEFAULT_STORAGE_PREFIX = 'cross-tab-worker-databus';
export const STORAGE_CHANNEL_PREFIX = `${DEFAULT_STORAGE_PREFIX}:channel:`;
export const TAB_ID_STORAGE_KEY = `${DEFAULT_STORAGE_PREFIX}:tab-id`;
export const PUBLICATION_EVENT = 'DATABUS_PUBLICATION';

// ---- 规范 JSON 信封操作码 ----
export const PUBLICATION_ENVELOPE_OP = 'publication';

// ---- trace 事件类型 ----
export const TRACE_EVENT_TYPE = {
  LIFECYCLE: 'lifecycle',
  STATUS: 'status',
  SUBSCRIPTION: 'subscription',
  COORDINATION: 'coordination',
  ERROR: 'error',
  RELIABILITY: 'reliability',
  MESSAGE_METRICS: 'message_metrics',
} as const;

// ---- trace 生命周期动作 ----
export const TRACE_LIFECYCLE_ACTION = {
  START: 'start',
  STOP: 'stop',
  SUSPEND: 'suspend',
  RESUME: 'resume',
} as const;

// ---- 内部 handler 调用标签（隔离异常时的分类来源）----
export const INVOKE_LABEL = {
  DISPATCH: 'dispatch',
  STATUS: 'status',
  ERROR_HANDLER: 'error handler',
} as const;

// ---- trace 模式（DataBusTraceMode）----
export const TRACE_MODE = {
  EVENTS: 'events',
  METRICS: 'metrics',
  ALL: 'all',
} as const;

// ---- trace 错误来源 ----
export const TRACE_ERROR_SOURCE = {
  TRANSPORT: 'transport',
  OPERATION: 'operation',
} as const;

// ---- reliability 诊断操作 ----
export const RELIABILITY_OPERATION = {
  TRANSPORT_RECOVERY: 'transport_recovery',
  ROUTE_ACK: 'route_ack',
  ROUTE_MIGRATION: 'route_migration',
  PERSISTENCE_CLEANUP: 'persistence_cleanup',
  PERSISTENCE_RETRY: 'persistence_retry',
  DEDUP_SUPPRESSED: 'dedup_suppressed',
} as const;

// ---- 自动恢复尝试结果 ----
export const RECOVERY_OUTCOME = {
  SCHEDULED: 'scheduled',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  EXHAUSTED: 'exhausted',
} as const;

// ---- 订阅动作 ----
export const SUBSCRIPTION_ACTION = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
} as const;

// ---- 回放修剪策略 ----
export const PRUNE_STRATEGY = {
  COUNT: 'count',
  AGE: 'age',
  BOTH: 'both',
} as const;

// ---- 持久化操作 ----
export const PERSISTENCE_OPERATION = {
  LOAD: 'load',
  APPEND: 'append',
  CLEAR: 'clear',
  CLEAR_TOPIC: 'clearTopic',
  CLEAR_BEFORE: 'clearBefore',
} as const;

// ---- 故障来源（DataBusFailureSource）----
export const FAILURE_SOURCE = {
  TRANSPORT: 'transport',
  PERSISTENCE: 'persistence',
  DISPATCH: 'dispatch',
} as const;

// ---- 健康判定状态（DataBusHealthSummary['state']）----
export const HEALTH_STATE = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  HEALTHY: 'healthy',
  RECOVERING: 'recovering',
  SUSPENDED: 'suspended',
  DEGRADED: 'degraded',
} as const;

// ---- WebSocket wire 协议操作码 ----
export const WS_OP = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PUBLISH: 'publish',
  PUBLISH_BATCH: 'publishBatch',
} as const;

// ---- Centrifuge Worker 输入消息类型 ----
export const CENTRIFUGE_INPUT_TYPE = {
  INIT: 'INIT',
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
  PUBLISH: 'PUBLISH',
  PUBLISH_BIN: 'PUBLISH_BIN',
  PING: 'PING',
  STOP: 'STOP',
} as const;

// ---- Centrifuge Worker 输出消息类型 ----
export const CENTRIFUGE_OUTPUT_TYPE = {
  STATUS: 'STATUS',
  MESSAGE: 'MESSAGE',
  MESSAGE_BIN: 'MESSAGE_BIN',
  ERROR: 'ERROR',
} as const;
