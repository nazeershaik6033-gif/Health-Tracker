import { useApp } from '@/stores/useApp';
import { IconCheck, IconWarning } from './icons';

/**
 * Single global toast, floating above the tab bar. The action (usually Undo)
 * is the point, so it gets the full 5s window from the store rather than a
 * shorter cosmetic timeout. Keyed on the toast id so a second toast replays
 * the entrance instead of silently swapping text.
 */
export function Toast() {
  const toast = useApp((s) => s.toast);
  const dismiss = useApp((s) => s.dismissToast);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
      <div
        key={toast.id}
        role="status"
        aria-live="polite"
        className="animate-toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[1.25rem] bg-[#0b0f14]/92 py-2.5 pr-2.5 pl-3 text-white shadow-[0_18px_40px_-14px_rgb(0_0_0/0.55)] ring-1 ring-white/10 backdrop-blur-xl"
      >
        {toast.tone === 'warn' ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
            <IconWarning width={15} height={15} />
          </span>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <IconCheck width={15} height={15} strokeWidth={2.6} />
          </span>
        )}
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{toast.message}</span>
        {toast.actionLabel && (
          <button
            type="button"
            className="pressable shrink-0 rounded-xl bg-white/12 px-3 py-1.5 text-[13px] font-bold text-white hover:bg-white/18"
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
