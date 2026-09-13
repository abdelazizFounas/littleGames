import type { ArenaSettings } from '../game/arena-settings';
export interface PracticeSession {
  updateSettings?: (settings: ArenaSettings) => void;
  start: () => void;
  pause: () => void;
  restart: () => void;
  stop: () => void;
}
export interface PracticeListeners {
  onSettings?: () => void;
  onPause: () => void;
  onFinish: (message: string) => void;
  onError: (message: string) => void;
}
