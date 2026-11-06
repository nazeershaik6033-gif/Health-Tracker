import { useApp } from '@/stores/useApp';
import { IconWarning } from './icons';

/**
 * Single global toast, pinned above the bottom nav. Mirrors the reference
 * app's "Roti added / Undo" pattern — the action is the point, so it gets the
 * full 5s window from the store rather than a shorter cosmetic timeout.
 */
export function Toast() {
  const toast = useApp((s) => s.toast);
  const dismiss = useApp((s) => s.dismissToast);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+var(--safe-bottom,0px)+var(--kb-inset,0px))] z-40 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="animate-toast-in pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-brand-700 px-4 py-3 text-white shadow-lg"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {/* A refusal ("Calories must be at least 800") shouldn't read like a confirmation. */}
          {toast.tone === 'warn' && (
            <IconWarning width={16} height={16} className="shrink-0 text-amber-300" />
          )}
          {toast.message}
        </span>
        {toast.actionLabel && (
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold underline-offset-2 hover:underline"
            onClick={async () => {
              await toast.onAction?.();
              dismiss();
            }}
          >
            {toast.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
