import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/stores/useApp';
import { Button } from './ui';

/**
 * The single global confirmation prompt, driven from the store like the toast.
 *
 * Deletes ask here on the first tap. The previous arm-then-confirm trash icon
 * asked for a second tap without ever saying so, and disarmed itself on focus
 * loss — so the question was invisible and the answer was often discarded. A
 * dialog costs the same tap and actually states what is about to happen.
 *
 * Centred rather than a bottom sheet: this interrupts, and a sheet reads as
 * something you can flick away.
 */
export function ConfirmDialog() {
  const confirm = useApp((s) => s.confirm);
  const dismiss = useApp((s) => s.dismissConfirm);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  const id = confirm?.id;

  useEffect(() => {
    if (!id) return;
    setBusy(false);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the destructive button rather than Cancel: the keyboard user came
    // here to answer, and Escape already cancels.
    const timer = setTimeout(() => confirmRef.current?.focus(), 50);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(timer);
    };
  }, [id, dismiss]);

  if (!confirm) return null;

  async function run() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await confirm.onConfirm();
    } finally {
      dismiss();
    }
  }

  const destructive = confirm.destructive !== false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div
        className="animate-fade-in absolute inset-0 bg-black/40"
        onClick={dismiss}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={confirm.body ? 'confirm-body' : undefined}
        className="surface-card animate-rise-in relative w-full max-w-xs p-5"
      >
        <h2 id="confirm-title" className="text-[16px] font-bold tracking-tight">
          {confirm.title}
        </h2>
        {confirm.body && (
          <p id="confirm-body" className="mt-1.5 text-[13px] leading-relaxed text-secondary">
            {confirm.body}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" full onClick={dismiss} disabled={busy}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            full
            onClick={run}
            disabled={busy}
          >
            {confirm.confirmLabel ?? 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
