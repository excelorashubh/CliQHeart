import { Heart } from 'lucide-react';

export function Brand({ compact = false }) {
  return <span className={`brand-mark${compact ? ' brand-mark--compact' : ''}`}>
    <span className="brand-icon"><Heart size={20} fill="currentColor" strokeWidth={2.2} /></span>
    {!compact && <span>CliQ<span>Heart</span></span>}
  </span>;
}

export function Avatar({ name = '', src, size = 'medium' }) {
  return <span className={`avatar avatar--${size}`} aria-hidden="true">
    {src ? <img src={src} alt="" /> : <span>{name.trim().charAt(0).toUpperCase() || '?'}</span>}
  </span>;
}
