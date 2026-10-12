import type { WidgetApi } from '../shared/ipc';

declare global {
  interface Window {
    widget: WidgetApi;
  }
}

export {};
