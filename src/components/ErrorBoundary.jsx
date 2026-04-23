import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  buildReport = () => {
    const { error, errorInfo } = this.state;
    const parts = [
      `Error: ${error?.toString() || 'Unknown'}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
      `Time: ${new Date().toISOString()}`,
      error?.stack ? `\nStack:\n${error.stack}` : '',
      errorInfo?.componentStack ? `\nComponent Stack:${errorInfo.componentStack}` : '',
    ];
    return parts.filter(Boolean).join('\n');
  };

  handleCopy = async () => {
    const text = this.buildReport();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (e) {
      this.setState({ copied: false });
    }
  };

  render() {
    if (this.state.hasError) {
      // Inline/section-level error (when used inside a page)
      if (this.props.inline) {
        return (
          <div className="p-6 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-center">
            <p className="text-red-700 dark:text-red-400 font-medium mb-2">
              {this.props.fallbackMessage || 'This section encountered an error.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
            >
              Try again
            </button>
            {this.state.error && (
              <details className="mt-3 text-left">
                <summary className="text-xs text-red-500 cursor-pointer">Error details</summary>
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={this.handleCopy}
                    className="text-[11px] px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60"
                  >
                    {this.state.copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="mt-1 p-2 rounded bg-red-100 dark:bg-red-900/30 text-[10px] text-red-600 dark:text-red-400 overflow-auto max-h-40 whitespace-pre-wrap break-words">
                  {this.buildReport()}
                </pre>
              </details>
            )}
          </div>
        );
      }

      // Full-page error (root-level)
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-8">
          <div className="max-w-md text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">An unexpected error occurred. You can try going back or refreshing the page.</p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2.5 rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              >
                Refresh page
              </button>
            </div>
            {this.state.error && (
              <details className="mt-6 text-left" open>
                <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                  Error details (tap to share)
                </summary>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={this.handleCopy}
                    className="text-xs px-3 py-1 rounded-md bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600"
                  >
                    {this.state.copied ? 'Copied!' : 'Copy details'}
                  </button>
                </div>
                <pre className="mt-2 p-3 rounded-lg bg-gray-100 dark:bg-slate-800 text-[11px] text-red-600 dark:text-red-400 overflow-auto max-h-64 whitespace-pre-wrap break-words text-left">
                  {this.buildReport()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
