import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render errors so a crash shows what broke instead of a white screen.
 *
 * Without this, React 19 unmounts the entire tree on an uncaught render error.
 * The result is indistinguishable from the app never loading at all, which
 * makes a device-specific crash impossible to diagnose from a screenshot —
 * exactly the position the blank-on-iOS report left us in.
 *
 * The boot guard in index.html covers the other half: failures before any of
 * this code runs. Between them there is no longer a silent blank state.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? '' });
    // Also leave it where the boot guard's collector can see it, so "copy
    // details" returns one report whichever layer caught the problem.
    const boot = (window as { __healthifyBoot?: { errors: unknown[] } }).__healthifyBoot;
    boot?.errors.push({ kind: 'react', message: error.message, stack: error.stack });
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const details = [
      `${error.name}: ${error.message}`,
      error.stack ?? '',
      componentStack ? `--- component stack ---${componentStack}` : '',
      `--- environment ---`,
      `url: ${window.location.href}`,
      `build: ${__BUILD_SHA__ || 'local'} ${__BUILD_TIME__}`,
      `ua: ${navigator.userAgent}`,
    ]
      .filter(Boolean)
      .join('\n');

    return (
      <div className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
        <h1 className="text-lg font-semibold">Something broke</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This screen hit an error. Your logged data is stored separately and is safe.
        </p>

        <pre className="mt-4 max-h-[45vh] overflow-auto rounded-xl bg-neutral-100 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words dark:bg-neutral-800">
          {details}
        </pre>

        <button
          type="button"
          className="mt-4 w-full rounded-xl border border-neutral-300 py-3 text-sm font-semibold dark:border-neutral-700"
          onClick={() => void navigator.clipboard?.writeText(details)}
        >
          Copy details
        </button>
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white"
          onClick={() => {
            // Back to the start rather than a reload: reloading a crashed
            // route just crashes it again.
            window.location.href = import.meta.env.BASE_URL;
          }}
        >
          Back to home
        </button>
      </div>
    );
  }
}
