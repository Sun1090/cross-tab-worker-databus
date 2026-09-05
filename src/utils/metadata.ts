/**
 * 发布元数据工具 —— 构造 { messageId?, timestamp? }，仅在字段已定义时写入，
 * 避免往 wire 帧/控制消息里塞空枚举字段。
 *
 * 此前 cluster.ts、data-bus.ts、centrifuge.ts、centrifuge-session.ts 各自内联
 * 实现了一遍 `...(x === undefined ? {} : { x })` 展开，行为容易漂移；统一到此
 * 一处后所有调用方共享同一语义。
 */
import type { DataBusPublicationMetadata } from '../core/types';

/**
 * Copy defined publication metadata without adding empty enumerable fields.
 * Returns `undefined` when neither field is set, so callers can preserve a
 * legacy "no metadata" argument shape (e.g. `onControl(..., undefined)`).
 */
export function publicationMetadata(
  messageId?: string,
  timestamp?: number
): DataBusPublicationMetadata | undefined {
  if (messageId === undefined && timestamp === undefined) return undefined;
  return {
    ...(messageId === undefined ? {} : { messageId }),
    ...(timestamp === undefined ? {} : { timestamp })
  };
}
