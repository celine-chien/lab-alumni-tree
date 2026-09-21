import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { lockScroll, unlockScroll } from '../lib/scrollLock.js';

export function Lightbox({ src, alt, caption, meta, actions, onClose }: {
  src: string;
  alt?: string;
  caption?: string;
  meta?: string;
  actions?: ComponentChildren;
  onClose: () => void;
}) {
  useEffect(() => {
    lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      unlockScroll();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div class="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button class="lightbox-close" aria-label="關閉" onClick={onClose}>×</button>
      <div class="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt ?? ''} />
        <div class="lightbox-info">
          {caption ? <div class="lightbox-caption">{caption}</div> : <div class="lightbox-caption muted">（沒有說明）</div>}
          {meta && <div class="muted small">{meta}</div>}
          {actions && <div class="lightbox-actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
