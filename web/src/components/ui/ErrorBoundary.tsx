import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });

    // Structured payload — ready for Sentry.captureException() when SDK is added
    const payload = {
      message:    error.message,
      name:       error.name,
      stack:      error.stack,
      component:  info.componentStack?.slice(0, 500),
      url:        window.location.href,
      ts:         new Date().toISOString(),
    };
    console.error('[DinePOS] Uncaught render error', payload);

    // Future hook: window.__dinePOSReportError?.(payload)
  }

  private copyDetails() {
    const { error, errorInfo } = this.state;
    const text = [
      `DinePOS Error Report`,
      `URL: ${window.location.href}`,
      `Error: ${error?.name}: ${error?.message}`,
      `Stack:\n${error?.stack ?? '(none)'}`,
      `Component:\n${errorInfo?.componentStack ?? '(none)'}`,
    ].join('\n\n');
    void navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const { error, copied } = this.state;

    return (
      <div className="flex min-h-screen items-center justify-center bg-mist p-8">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-red-500">
            Unexpected Error
          </p>
          <h1 className="mb-3 text-lg font-bold text-ink">Something went wrong</h1>
          <p className="mb-6 text-sm text-ink/50">
            {error.message || 'An unexpected error occurred.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand/90"
            >
              Reload Page
            </button>
            <button
              onClick={() => this.copyDetails()}
              className="rounded-lg border border-red-200 px-5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100"
            >
              {copied ? 'Copied!' : 'Copy Error Details'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
