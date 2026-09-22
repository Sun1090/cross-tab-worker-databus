/**
 * Direct unit coverage for the error-rendering helpers. The session-level tests
 * exercise the happy paths indirectly; these pin the exact branch behavior:
 * stack preservation, non-Error shapes, undefined context omission, round-trip
 * reconstruction, and the totality of `describeFailure` over reasons that have no
 * primitive conversion at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { deserializeWorkerError, describeFailure, serializeError } from '../src/utils/error-utils';

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

  it('always yields a structured-cloneable result, dropping a non-cloneable context', () => {
    // The whole point of serializeError is to make a postMessage payload. A
    // function/symbol (or an object holding one) used as context would make the
    // serialised error itself uncloneable, so reporting the failure would throw
    // DataCloneError at the Worker boundary.
    const nonCloneable: unknown[] = [
      () => undefined,
      Symbol('s'),
      { fn: () => undefined },
      [() => undefined],
      new Map([['k', () => undefined]])
    ];
    for (const value of nonCloneable) {
      const serialized = serializeError(value);
      expect(() => structuredClone(serialized), `context leaked for ${String(value)}`).not.toThrow();
      expect(serialized).not.toHaveProperty('context');
    }

    // Cloneable contexts are still preserved for diagnostics.
    expect(serializeError({ code: 42 })).toMatchObject({ context: { code: 42 } });
    expect(serializeError('boom')).toMatchObject({ context: 'boom' });
  });

  it('keeps the context when the runtime has no structuredClone to probe with', () => {
    // The cloneability probe is best effort: an older browser without
    // `structuredClone` must keep whatever context it can (the eventual
    // postMessage fails either way) rather than silently discard diagnostics.
    const original = globalThis.structuredClone;
    vi.stubGlobal('structuredClone', undefined);
    try {
      const serialized = serializeError(() => undefined);
      expect(serialized).toHaveProperty('context');
      expect(typeof serialized.context).toBe('function');
      expect(serializeError({ code: 42 })).toMatchObject({ context: { code: 42 } });
    } finally {
      vi.stubGlobal('structuredClone', original);
      vi.unstubAllGlobals();
    }
  });

  it('describes an Error by its message and other values by their coercion', () => {
    expect(describeFailure(new RangeError('out of range'))).toBe('out of range');
    expect(describeFailure('backend said no')).toBe('backend said no');
    expect(describeFailure(404)).toBe('404');
    expect(describeFailure(undefined)).toBe('undefined');
    expect(describeFailure(null)).toBe('null');
    expect(describeFailure({ code: 42 })).toBe('[object Object]');
  });

  it('describes a value that has no primitive conversion instead of throwing', () => {
    // The whole point of the helper: it runs while *reporting* a failure, so a
    // throw here replaces the real reason with one about the formatter and turns
    // a resolving `.catch(error => reportError(error))` chain into a rejecting one.
    expect(() => String(Object.create(null))).toThrow(TypeError);
    expect(describeFailure(Object.create(null))).toBe('[unstringifiable object]');

    const hostile = {
      toString() {
        throw new Error('nope');
      }
    };
    expect(() => String(hostile)).toThrow('nope');
    expect(describeFailure(hostile)).toBe('[unstringifiable object]');

    // A throwing `message` getter is still the `Error` branch, so the guard has to
    // cover it rather than only the `String()` path. Defined on the instance,
    // because `new Sub('x')` writes an own data property that shadows a prototype
    // getter and never reaches it.
    const badMessage = new Error('x');
    Object.defineProperty(badMessage, 'message', {
      get(): string {
        throw new Error('cannot read message');
      }
    });
    expect(describeFailure(badMessage)).toBe('[unstringifiable object]');
  });
});
