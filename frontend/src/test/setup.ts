import '@testing-library/jest-dom/vitest';

// Polyfill EventSource for test environment
if (typeof window !== 'undefined' && !window.EventSource) {
  class MockEventSource {
    url: string;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners: Record<string, ((event: any) => void)[]> = {};

    constructor(url: string) {
      this.url = url;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 10);
    }

    addEventListener(type: string, listener: (event: any) => void) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(listener);
    }

    removeEventListener(type: string, listener: (event: any) => void) {
      if (!this.listeners[type]) return;
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }

    close() {}
  }

  (window as any).EventSource = MockEventSource;
}
