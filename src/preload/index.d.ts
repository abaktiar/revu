import type { RevuApi } from './index';

declare global {
  interface Window {
    revu: RevuApi;
  }
}

export {};
