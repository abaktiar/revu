import type { IpcErrorCode, IpcResult } from '@shared/types';

// Renderer-side error type that mirrors the main process's ProviderError.
// Components can `catch (err)` as usual and read err.message / err.code /
// err.hint to render an actionable error UI without branching on the result
// envelope at every call site.
export class IpcError extends Error {
  readonly code: IpcErrorCode;
  readonly hint?: string;

  constructor(message: string, code: IpcErrorCode, hint?: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
    this.hint = hint;
  }
}

// Throws an IpcError on failure so React component code can use try/catch
// instead of branching on the result envelope everywhere.
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p;
  if (!res.ok) {
    throw new IpcError(res.error, res.errorCode ?? 'unknown', res.errorHint);
  }
  return res.value;
}

export const api = window.revu;
