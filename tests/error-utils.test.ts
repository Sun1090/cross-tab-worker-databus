/**
 * Direct unit coverage for the Worker-boundary error serialization helpers.
 * The session-level tests exercise the happy paths indirectly; these pin the
 * exact branch behavior: stack preservation, non-Error shapes, undefined
 * context omission, and round-trip reconstruction.
 */
import { describe, expect, it } from 'vitest';
import { deserializeWorkerError, serializeError } from '../src/utils/error-utils';

describe('error-utils', () => {
  it('serializes an Error with name, message, and stack when present', () => {
    const error = new TypeError('boom');
    const serialized = serializeError(error);
    expect(serialized).toEqual({ name: 'TypeError', message: 'boom', stack: expect.any(String) });
  });

  it('omits the stack field for an Error without one', () => {
    const error = new Error('no stack');
    error.stack = '';
    expect(serializeError(error)).toEqual({ name: 'Error', message: 'no stack' });
  });

  it('serializes a string failure as the message itself, with the string as context', () => {
    expect(serializeError('boom-string')).toEqual({
      name: 'CentrifugeError',
      message: 'boom-string',
      context: 'boom-string'
    });
  });

  it('serializes an object failure with the original as context', () => {
    const context = { code: 42, detail: 'x' };
    expect(serializeError(context)).toEqual({
      name: 'CentrifugeError',
      message: 'Centrifuge worker operation failed.',
      context
    });
  });

  it('serializes undefined without a context field', () => {
    expect(serializeError(undefined)).toEqual({
      name: 'CentrifugeError',
      message: 'Centrifuge worker operation failed.'
    });
    expect(serializeError(undefined)).not.toHaveProperty('context');
  });

  it('serializes numbers and booleans as context-carrying failures', () => {
    expect(serializeError(7)).toMatchObject({ context: 7 });
    expect(serializeError(false)).toMatchObject({ context: false });
  });

  it('reconstructs an Error with name, message, and stack restored', () => {
    const error = deserializeWorkerError({ name: 'RangeError', message: 'bad range', stack: 'RangeError: bad range\n    at x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RangeError');
    expect(error.message).toBe('bad range');
    expect(error.stack).toBe('RangeError: bad range\n    at x');
  });

  it('reconstructs without touching stack or context when absent', () => {
    const error = deserializeWorkerError({ name: 'Error', message: 'plain' });
    expect(error.message).toBe('plain');
    expect((error as { context?: unknown }).context).toBeUndefined();
    expect(error.stack).not.toBe('');
  });

  it('attaches the context field onto the reconstructed error', () => {
    const error = deserializeWorkerError({ name: 'CentrifugeError', message: 'failed', context: { code: 1 } });
    expect((error as { context?: { code: number } }).context).toEqual({ code: 1 });
  });

  it('round-trips: serialize → deserialize keeps the observable identity', () => {
    const original = new Error('round trip');
    const restored = deserializeWorkerError(serializeError(original));
    expect(restored.name).toBe('Error');
    expect(restored.message).toBe('round trip');
  });
});
