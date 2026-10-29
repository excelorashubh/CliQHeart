import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

function retrySecondsFromMessage(message) {
  const match = /Try again in (\d+) seconds?/i.exec(message || '');
  return match ? Number(match[1]) : 0;
}

export function RetryButton({
  error,
  onRetry,
  disabled = false,
  className = 'button button--outline',
  label = 'Try again',
  showIcon = false,
}) {
  const retrySeconds = retrySecondsFromMessage(error);
  const [retryUntil, setRetryUntil] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (retrySeconds <= 0) {
      setRetryUntil(0);
      setRemainingSeconds(0);
      return;
    }
    const until = Date.now() + retrySeconds * 1000;
    setRetryUntil(until);
    setRemainingSeconds(retrySeconds);
  }, [error, retrySeconds]);

  useEffect(() => {
    if (!retryUntil) return undefined;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) setRetryUntil(0);
    };
    const timer = window.setInterval(updateRemaining, 250);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  return <button
    type="button"
    className={className}
    onClick={onRetry}
    disabled={disabled || remainingSeconds > 0}
  >
    {showIcon && <RefreshCw size={15} aria-hidden="true" />}
    {remainingSeconds > 0 ? `Try again in ${remainingSeconds}s` : label}
  </button>;
}

export function ErrorState({ error, onRetry, retryDisabled = false, retryLabel = 'Try again' }) {
  return <div className="state-card state-card--error" role="alert">
    <AlertCircle size={22} />
    <p>{error || 'Something went wrong.'}</p>
    {onRetry && <RetryButton
      error={error}
      onRetry={onRetry}
      disabled={retryDisabled}
      className="button button--outline"
      label={retryLabel}
      showIcon
    />}
  </div>;
}

export function EmptyState({ title, description, icon: Icon }) {
  return <div className="state-card">
    {Icon && <span className="empty-icon"><Icon size={22} /></span>}
    <h3>{title}</h3>
    <p>{description}</p>
  </div>;
}

export function PageSpinner({ label = 'Loading…' }) {
  return <div className="page-loading" aria-label={label}><span /></div>;
}

export function Skeleton({ rows = 3 }) {
  return <div className="skeleton-list" aria-label="Loading content" aria-busy="true">
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><span /><div><i /><i /></div></div>)}
  </div>;
}
