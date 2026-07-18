import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Custom fallback UI. If omitted, a generic recovery screen is shown. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DinePOS] Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAF9] p-8">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-red-500">
            Unexpected Error
          </p>
          <h1 className="mb-3 text-lg font-bold text-[#1C0800]">Something went wrong</h1>
          <p className="mb-6 text-sm text-gray-500">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-[#E8380D] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#E8380D]/90"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}
