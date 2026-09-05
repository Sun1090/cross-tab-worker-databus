/**
 * 错误序列化工具 —— 在 Worker 边界往返传输 Error。
 *
 * Error 实例无法通过 postMessage 结构化克隆，所以 CentrifugeSession 侧用
 * serializeError 把它压成 plain object，主线程侧用 deserializeWorkerError
 * 还原成真 Error（带 name/stack）。此前两个函数分别内联在 centrifuge-session.ts
 * 与 centrifuge.ts，此处统一定义并从两处引用。
 */

/** Error object serialized for cross-thread transfer. */
export interface SerializedWorkerError {
  /** The Error's `name` (e.g. 'TypeError', 'CentrifugeError'). */
  name: string;
  /** The Error's `message`. */
  message: string;
  /** The Error's `stack` if available (for debugging). */
  stack?: string;
  /** Arbitrary context attached by the Worker (e.g. the failing operation). */
  context?: unknown;
}

/** Convert an arbitrary error into a structured-cloneable form for postMessage. */
export function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  return {
    name: 'CentrifugeError',
    message: typeof error === 'string' ? error : 'Centrifuge worker operation failed.',
    ...(error === undefined ? {} : { context: error })
  };
}

/** Reconstruct an Error instance from its serialised form. */
export function deserializeWorkerError(error: SerializedWorkerError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack) result.stack = error.stack;
  if (error.context !== undefined) Object.assign(result, { context: error.context });
  return result;
}
