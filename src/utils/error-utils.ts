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

/** Convert an arbitrary error into a structured-cloneable form for postMessage.
 * A non-Error value is attached as `context`, but only when it is itself
 * structured-cloneable: a function, symbol, or an object/map holding one would
 * otherwise make the serialised error unserializable, so `postMessage` would
 * throw `DataCloneError` while reporting the original failure. */
export function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  const context = error === undefined ? undefined : error;
  return {
    name: 'CentrifugeError',
    message: typeof error === 'string' ? error : 'Centrifuge worker operation failed.',
    ...(context === undefined || !isStructuredCloneable(context) ? {} : { context })
  };
}

/** True when `value` survives a structured clone. When the runtime has no
 * `structuredClone`, cloneability cannot be checked and the value is kept
 * (best effort); the eventual postMessage would fail either way. */
function isStructuredCloneable(value: unknown): boolean {
  if (typeof structuredClone !== 'function') return true;
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

/** Reconstruct an Error instance from its serialised form. */
export function deserializeWorkerError(error: SerializedWorkerError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack) result.stack = error.stack;
  if (error.context !== undefined) Object.assign(result, { context: error.context });
  return result;
}
