export interface PracticeSession {
  start: () => void;
  pause: () => void;
  restart: () => void;
  stop: () => void;
}
export interface PracticeListeners {
  onPause: () => void;
  onFinish: (message: string) => void;
  onError: (message: string) => void;
}
