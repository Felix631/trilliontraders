/**
 * The card renders from this hook, so it has to re-render as the store counts and
 * report `done` once the bar has finished at 100%.
 */
import { act, renderHook } from '@testing-library/react';
import { useBootProgress } from '../useBootProgress';
import { bootProgress } from '@/stores/boot-progress-store';

jest.useFakeTimers();

describe('useBootProgress', () => {
    it('reports the counted percentage and the stage it is on', () => {
        const { result } = renderHook(() => useBootProgress());
        expect(result.current).toEqual({ percent: 0, stage: 'connecting', done: false });

        act(() => {
            bootProgress.startStage('markets');
            jest.advanceTimersByTime(1000);
        });

        expect(Math.round(result.current.percent)).toBeGreaterThan(20);
        expect(result.current.stage).toBe('markets');
        expect(result.current.done).toBe(false);
    });

    it('reports done once the bar has reached 100% and held there', () => {
        const { result } = renderHook(() => useBootProgress());

        act(() => {
            bootProgress.finish();
            jest.advanceTimersByTime(10000);
        });

        expect(result.current.percent).toBe(100);
        expect(result.current.stage).toBe('ready');
        expect(result.current.done).toBe(true);
    });
});
