import type { IpcResult } from '@shared/types';

// Throws the error string on failure so React component code can use try/catch
// instead of branching on the result envelope everywhere.
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p;
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

export const api = window.revu;
