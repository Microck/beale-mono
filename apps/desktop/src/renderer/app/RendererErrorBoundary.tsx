import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export class RendererErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  public state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Beale renderer failed:', error, info.componentStack);
  }

  public render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="renderer-error" role="alert">
        <h1>Beale could not display this view</h1>
        <p>Reload the window to reopen the workspace.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload Beale</button>
      </main>
    );
  }
}
