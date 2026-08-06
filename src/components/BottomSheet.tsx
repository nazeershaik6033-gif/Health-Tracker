import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Sticky footer that stays visible above the fold, e.g. "Track For Dinner". */
  footer?: ReactNode;
  maxHeight?: string;
}

export function BottomSheet({ open, onClose, title, children, footer, maxHeight = '85vh' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Lock the page behind the sheet so iOS doesn't scroll it under the panel.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus in so the sheet is reachable by keyboard and screen readers.
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 50);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="animate-fade-in absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet-up relative flex w-full max-w-lg flex-col outline-none"
        style={{
          maxHeight,
          background: 'var(--surface-card)',
          borderTopLeftRadius: 'var(--radius-sheet)',
          borderTopRightRadius: 'var(--radius-sheet)',
        }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="surface-sunken h-1 w-10 rounded-full" />
        </div>
        {title && (
          <h2 className="px-5 pt-2 pb-3 text-[17px] font-bold tracking-tight">{title}</h2>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">{children}</div>
        {footer && (
          <div className="hairline border-t px-5 pt-3 pb-safe">{footer}</div>
        )}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>
  );
}
