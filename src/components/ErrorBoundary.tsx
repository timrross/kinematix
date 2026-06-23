/**
 * Last line of defence. Referential validation already rejects malformed designs
 * at load, but if anything still slips through and throws during render, we show
 * a calm recovery screen instead of a white page — and offer a one-click reset
 * that clears the saved session and any stale share link.
 */

import { Component, type ReactNode } from 'react';
import { STORAGE_KEY } from '../persistence/serialize';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    location.hash = '';
    location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="boundary">
          <div className="boundary-card">
            <h1>Something jammed</h1>
            <p>
              The design couldn't be drawn. This is usually a corrupt save or an
              out-of-date share link.
            </p>
            <p className="boundary-detail">{this.state.error.message}</p>
            <button className="btn btn-primary" onClick={this.reset}>
              Reset to a working bike
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
