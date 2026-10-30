/**
 * Boot progress — the single percentage the boot splash shows.
 *
 * The app used to hand the splash a fixed number per stage, so it jumped 24 → 58 →
 * 86 and never actually finished: each stage re-mounted the card with its own
 * value. Now one number climbs from 0 to 100. Each boot stage lifts the ceiling the
 * bar is allowed to grow to, `finish()` (called once everything is loaded) lifts it
 * to 100, and the value is eased so the bar and the percentage keep moving on their
 * own instead of sitting on a stage number while the app works.
 */
export type TBootStage = 'connecting' | 'workspace' | 'markets' | 'builder' | 'ready';

/** Boot stages in order; 'ready' means everything is loaded. */
export const BOOT_STAGES: TBootStage[] = ['connecting', 'workspace', 'markets', 'builder', 'ready'];

/** How far each stage may let the bar climb before it waits for the next one. */
const STAGE_CEILING: Record<TBootStage, number> = {
    connecting: 34,
    workspace: 68,
    markets: 94,
    // The bot builder's workspace — the app's own last step before it opens.
    builder: 99,
    ready: 100,
};

const TICK_MS = 50;
/** Share of the distance left to the ceiling that each tick covers. */
const EASE = 0.07;
/** …plus a floor, so the number keeps crawling instead of stalling just short of it. */
const CREEP = 0.25;
/** How long a finished 100% stays on screen before the app opens. */
const FULL_HOLD_MS = 400;

export type TBootProgress = {
    percent: number;
    stage: TBootStage;
    /** Everything is loaded *and* the bar has finished: the app can open. */
    done: boolean;
};

// The snapshot is replaced (never mutated) so it can be compared by reference, which
// is what useSyncExternalStore needs to know when to re-render.
let snapshot: TBootProgress = { percent: 0, stage: 'connecting', done: false };
let ceiling = STAGE_CEILING.connecting;
let full_since: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

const emit = () => listeners.forEach(listener => listener());

const stopTicking = () => {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
};

const tick = () => {
    const percent = Math.min(ceiling, snapshot.percent + Math.max(CREEP, (ceiling - snapshot.percent) * EASE));
    const is_full = percent >= STAGE_CEILING.ready;

    if (is_full && full_since === null) full_since = Date.now();
    const done = full_since !== null && Date.now() - full_since >= FULL_HOLD_MS;

    snapshot = { percent, stage: is_full ? 'ready' : snapshot.stage, done };
    emit();

    if (done) stopTicking();
};

const startTicking = () => {
    if (timer === null && !snapshot.done) timer = setInterval(tick, TICK_MS);
};

export const bootProgress = {
    /**
     * Reports that a stage is running, letting the bar climb to its ceiling. A stage
     * that has already been passed is ignored, so a re-mounted splash can never send
     * the percentage backwards.
     */
    startStage(stage: TBootStage): void {
        if (BOOT_STAGES.indexOf(stage) > BOOT_STAGES.indexOf(snapshot.stage)) {
            ceiling = STAGE_CEILING[stage];
            snapshot = { ...snapshot, stage };
            emit();
        }
        startTicking();
    },

    /** Everything is loaded — take the bar to 100% and hold it there. */
    finish(): void {
        ceiling = STAGE_CEILING.ready;
        startTicking();
    },

    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    getSnapshot(): TBootProgress {
        return snapshot;
    },
};
