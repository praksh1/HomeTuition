import React from "react";
import { createRoot } from "react-dom/client";
import DropClass from "../../components/DropClass";

class FixtureBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error) { (window as any).__dropFixtureError = error.message; }
  render() {
    return this.state.error ? <div data-testid="fixture-crash">{this.state.error}</div> : this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <FixtureBoundary><DropClass sessionId={501} /></FixtureBoundary>,
);
