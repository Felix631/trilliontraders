import { useSyncExternalStore } from 'react';
import { bootProgress } from '@/stores/boot-progress-store';

/** Live boot progress: `percent` for the bar and `done` once everything is loaded. */
export const useBootProgress = () => useSyncExternalStore(bootProgress.subscribe, bootProgress.getSnapshot);
