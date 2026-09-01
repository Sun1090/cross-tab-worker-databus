import type { DataBusPublication } from './types';

/**
 * Normalize legacy flat publications, metadata payload envelopes, and the
 * canonical `{ op: 'publication', publication: ... }` shape.
 *
 * `fallbackTopic` is used by transports such as Centrifuge where the channel
 * is supplied out-of-band by the client library rather than inside the data.
 */
export function parseDataBusPublication<TData = unknown>(
  value: unknown,
  fallbackTopic?: string
): DataBusPublication<TData> | null {
  if (!value || typeof value !== 'object') {
    return fallbackTopic ? { topic: fallbackTopic, data: value as TData } : null;
  }
  const frame = value as Record<string, unknown>;
  const nested = frame.publication && typeof frame.publication === 'object'
    ? frame.publication as Record<string, unknown>
    : null;
  const publication = nested ?? frame;
  const topic = typeof publication.topic === 'string' ? publication.topic : fallbackTopic;
  if (!topic) return null;

  // Centrifuge's legacy metadata envelope carries `{ data, messageId }`
  // without a topic because the channel is provided by PublicationContext.
  const hasMetadataEnvelope = fallbackTopic !== undefined
    && Object.prototype.hasOwnProperty.call(publication, 'data')
    && (typeof publication.messageId === 'string' || typeof publication.timestamp === 'number');
  const data = nested || fallbackTopic === undefined || hasMetadataEnvelope
    ? publication.data
    : value;
  return {
    topic,
    data: data as TData,
    ...(typeof publication.messageId === 'string' ? { messageId: publication.messageId } : {}),
    ...(typeof publication.timestamp === 'number' ? { timestamp: publication.timestamp } : {})
  };
}
