import { render, screen } from '@testing-library/react';
import ChunkLoader from '../chunk-loader';

const mock_progress = { percent: 42.6, stage: 'workspace', done: false };

jest.mock('@/hooks/useBootProgress', () => ({ useBootProgress: () => mock_progress }));
jest.mock('@/stores/boot-progress-store', () => ({ bootProgress: { startStage: jest.fn() } }));
jest.mock('@/utils/boot-splash', () => ({ hideBootSplash: jest.fn() }));

const { bootProgress } = jest.requireMock('@/stores/boot-progress-store');
const { hideBootSplash } = jest.requireMock('@/utils/boot-splash');

const step_states = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.boot-card__step')).map(step =>
        ['done', 'current', 'pending'].find(state => step.classList.contains(`boot-card__step--${state}`))
    );

describe('ChunkLoader', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mock_progress.percent = 42.6;
        mock_progress.stage = 'workspace';
        mock_progress.done = false;
    });

    describe('the boot splash', () => {
        it('shows a whole percentage with the bar at the same width', () => {
            const { container } = render(<ChunkLoader variant='splash' stage='connecting' />);

            expect(screen.getByTestId('dt_boot_splash')).toBeInTheDocument();
            // 42.6 counts as 43 — never a decimal.
            expect(screen.getByTestId('dt_boot_percent')).toHaveTextContent('43%');
            expect((container.querySelector('.boot-card__bar-fill') as HTMLElement).style.width).toBe('43%');
        });

        it('centres the app name instead of showing a logo', () => {
            const { container } = render(<ChunkLoader variant='splash' stage='connecting' />);

            expect(screen.getByTestId('dt_boot_name')).toHaveTextContent('Trillion Trades');
            expect(container.querySelector('.app-header__logo-mark')).toBeNull();
            expect(container.querySelector('.boot-card__live')).toBeNull();
        });

        it('lists the stages, ticking the ones it has passed', () => {
            const { container } = render(<ChunkLoader variant='splash' stage='connecting' />);

            expect(step_states(container)).toEqual(['done', 'current', 'pending']);
            expect(screen.getByText('Connecting to the server')).toBeInTheDocument();
            expect(screen.getByText('Loading your workspace')).toBeInTheDocument();
            expect(screen.getByText('Loading markets and your account')).toBeInTheDocument();
        });

        it('ticks every stage and says so once the bar is full', () => {
            mock_progress.stage = 'ready';
            mock_progress.percent = 100.0;
            const { container } = render(<ChunkLoader variant='splash' stage='markets' />);

            expect(step_states(container)).toEqual(['done', 'done', 'done']);
            expect(screen.getByText('Ready — opening your trading hub...')).toBeInTheDocument();
        });

        it('reports its stage and hands the pre-React cover over', () => {
            render(<ChunkLoader variant='splash' stage='markets' />);

            expect(bootProgress.startStage).toHaveBeenCalledWith('markets');
            expect(hideBootSplash).toHaveBeenCalledTimes(1);
        });
    });

    describe('the inline loader', () => {
        it('stays a plain spinner + message and leaves the boot alone', () => {
            const { container } = render(<ChunkLoader message='Please wait, loading tutorials...' />);

            expect(screen.getByText('Please wait, loading tutorials...')).toBeInTheDocument();
            expect(container.querySelector('.boot-card')).toBeNull();
            expect(hideBootSplash).not.toHaveBeenCalled();
            expect(bootProgress.startStage).not.toHaveBeenCalled();
        });
    });
});
