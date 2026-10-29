import { AlertCircle, RefreshCw } from 'lucide-react';

export function ErrorState({ error, onRetry }) {
  return <div className="state-card state-card--error" role="alert">
    <AlertCircle size={22} />
    <p>{error || 'Something went wrong.'}</p>
    {onRetry && <button className="button button--outline" onClick={onRetry}><RefreshCw size={15} /> Try again</button>}
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
