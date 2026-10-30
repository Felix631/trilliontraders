/**
 * The boot bar must count up on its own, never go backwards, and only report `done`
 * after it has sat at 100%.
 */
import type { TBootProgress, TBootStage } from '../boot-progress-store';

type TBootProgressStore = {
    startStage: (stage: TBootStage) => void;
    finish: () => void;
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => TBootProgress;
};

jest.useFakeTimers();

const loadStore = (): TBootProgressStore => {
    // A fresh store per test: the module holds the interval and the snapshot.
    jest.resetModules();

    return require('../boot-progress-store').bootProgress;
};

describe('bootProgress', () => {
    beforeEach(() => jest.clearAllTimers());

    it('starts at zero on the first stage', () => {
        expect(loadStore().getSnapshot()).toEqual({ percent: 0, stage: 'connecting', done: false });
    });

    it('counts up while a stage runs', () => {
        const store = loadStore();
        store.startStage('connecting');

        jest.advanceTimersByTime(500);
        const early = store.getSnapshot().percent;

        jest.advanceTimersByTime(1500);

        expect(early).toBeGreaterThan(0);
        expect(store.getSnapshot().percent).toBeGreaterThan(early);
    });

    it('stops at the stage ceiling instead of running away', () => {
        const store = loadStore();
        store.startStage('connecting');

        jest.advanceTimersByTime(30000);

        expect(store.getSnapshot().percent).toBe(34);
        expect(store.getSnapshot().stage).toBe('connecting');
    });

    it('climbs on when the next stage lifts the ceiling', () => {
        const store = loadStore();
        store.startStage('connecting');
        jest.advanceTimersByTime(30000);

        store.startStage('workspace');
        jest.advanceTimersByTime(30000);
        expect(store.getSnapshot().percent).toBe(68);

        store.startStage('markets');
        jest.advanceTimersByTime(30000);
        expect(store.getSnapshot().percent).toBe(94);

        // The bot builder's workspace is the last step before the bar is full.
        store.startStage('builder');
        jest.advanceTimersByTime(30000);
        expect(store.getSnapshot().percent).toBe(99);
        expect(store.getSnapshot().stage).toBe('builder');
    });

    it('ignores a stage that has already been passed', () => {
        const store = loadStore();
        store.startStage('markets');
        jest.advanceTimersByTime(30000);

        store.startStage('connecting');

        expect(store.getSnapshot().stage).toBe('markets');
        expect(store.getSnapshot().percent).toBe(94);
    });

    it('shows 100% before the app is allowed to open', () => {
        const store = loadStore();
        const seen: TBootProgress[] = [];
        store.subscribe(() => seen.push(store.getSnapshot()));

        store.startStage('markets');
        store.finish();
        jest.advanceTimersByTime(10000);

        const at_full = seen.find(state => state.percent === 100);
        expect(at_full).toEqual({ percent: 100, stage: 'ready', done: false });
        // …and only then does it let the app open.
        expect(store.getSnapshot()).toEqual({ percent: 100, stage: 'ready', done: true });
    });

    it('only ever counts upwards', () => {
        const store = loadStore();
        const seen: number[] = [];
        store.subscribe(() => seen.push(store.getSnapshot().percent));

        store.startStage('connecting');
        jest.advanceTimersByTime(2000);
        store.startStage('workspace');
        jest.advanceTimersByTime(2000);
        store.startStage('markets');
        jest.advanceTimersByTime(2000);
        store.startStage('builder');
        jest.advanceTimersByTime(2000);
        store.finish();
        jest.advanceTimersByTime(10000);

        expect(seen).toEqual([...seen].sort((a, b) => a - b));
    });

    it('goes quiet once it is done', () => {
        const store = loadStore();
        const listener = jest.fn();
        store.subscribe(listener);

        store.finish();
        jest.advanceTimersByTime(10000);
        const calls_when_done = listener.mock.calls.length;

        jest.advanceTimersByTime(10000);

        expect(listener).toHaveBeenCalledTimes(calls_when_done);
    });
});
