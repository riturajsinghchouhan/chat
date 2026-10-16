import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-60 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="neu flex h-16 w-16 items-center justify-center rounded-2xl text-accent">
          <AlertTriangle />
        </div>
        <div>
          <h2 className="text-lg font-bold">Something went wrong</h2>
          <p className="mt-1 text-sm text-muted">This part of the app crashed. Your messages are safe.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
