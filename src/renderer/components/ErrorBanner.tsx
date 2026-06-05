import type { ReactNode } from 'react';
import type { IpcErrorCode } from '@shared/types';
import { IpcError } from '../api';
import {
  AlertCircle,
  Clock,
  Key,
  XCircle,
  Search,
  AlertTriangle,
  Wifi,
  X,
} from '../icons';

// Shared error UI for IPC failures. Renders the classified message + hint
// from a ProviderError (via IpcError) so the user always sees an actionable
// next step alongside the raw failure text.
export function ErrorBanner({
  title,
  error,
  onRetry,
  retryLabel,
  retrying,
  onOpenSettings,
  extra,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  onOpenSettings?: () => void;
  extra?: ReactNode;
}): JSX.Element {
  const info = classify(error);
  const showSettings =
    info.code === 'credentials_expired' || info.code === 'credentials_missing';
  const Icon = iconFor(info.code);
  return (
    <div className={`error error-${info.code}`} role="alert">
      <div className="error-head">
        <span className="error-icon" aria-hidden>
          <Icon size={16} />
        </span>
        <span className="error-title">{title}</span>
      </div>
      <div className="error-message">{info.message}</div>
      {info.hint && <div className="error-hint">{info.hint}</div>}
      {(onRetry || (showSettings && onOpenSettings) || extra) && (
        <div className="error-actions">
          {onRetry && (
            <button
              className="primary"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? 'Retrying…' : retryLabel ?? 'Try again'}
            </button>
          )}
          {showSettings && onOpenSettings && (
            <button onClick={onOpenSettings}>Open Settings</button>
          )}
          {extra}
        </div>
      )}
    </div>
  );
}

function classify(err: unknown): {
  code: IpcErrorCode;
  message: string;
  hint?: string;
} {
  if (err instanceof IpcError) {
    return { code: err.code, message: err.message, hint: err.hint };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

function iconFor(code: IpcErrorCode): typeof AlertCircle {
  switch (code) {
    case 'throttled':
      return Clock;
    case 'credentials_expired':
    case 'credentials_missing':
      return Key;
    case 'access_denied':
      return XCircle;
    case 'not_found':
      return Search;
    case 'conflict':
      return AlertTriangle;
    case 'network':
    case 'timeout':
      return Wifi;
    default:
      return X;
  }
}
