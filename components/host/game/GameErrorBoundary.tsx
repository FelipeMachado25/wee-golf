"use client";

import { Component, type ReactNode } from "react";

/** A crash inside the 3D canvas otherwise blanks the screen with Next's generic
 *  "client-side exception" page, which tells us nothing. Show the real message
 *  so a player can read it out and we can fix it. */
export class GameErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[wee-golf] game crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-8 text-neutral-100">
        <h1 className="text-xl font-bold text-red-400">The game crashed</h1>
        <pre className="max-w-2xl overflow-auto rounded-xl bg-neutral-900 p-4 text-left font-mono text-xs text-red-300">
          {error.message}
        </pre>
        <p className="max-w-md text-center text-sm text-neutral-500">
          Send this message along and it can be fixed. Reload to try again.
        </p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-emerald-500 px-6 py-3 font-bold text-neutral-950">
          Reload
        </button>
      </main>
    );
  }
}
