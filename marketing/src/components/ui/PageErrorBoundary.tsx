import { Component } from 'react';
import type { ReactNode } from 'react';
import { isStaleChunkError, reloadForStaleChunk } from '../../utils/staleChunkReload';

interface Props { children: ReactNode }
interface State { failed: boolean }

/** Shows a "Reload" message instead of a blank page if a page fails to load. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // A tab opened before a deploy asks for files that no longer exist — reload once.
    if (isStaleChunkError(error) && reloadForStaleChunk()) return;
    console.error('[DinePOS site] Page failed to load', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-lg font-semibold text-gray-900">This page didn't load.</p>
        <p className="text-sm text-gray-600">The website may have just been updated. Reloading usually fixes it.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-[#E8380D] px-5 py-2 text-sm font-semibold text-white hover:bg-[#C93008]"
        >
          Reload
        </button>
      </div>
    );
  }
}
