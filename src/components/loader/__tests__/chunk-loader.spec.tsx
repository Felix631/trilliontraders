import { render, screen } from '@testing-library/react';
import ChunkLoader from '../chunk-loader';

jest.mock('@/utils/boot-splash', () => ({ hideBootSplash: jest.fn() }));

const { hideBootSplash } = jest.requireMock('@/utils/boot-splash');

describe('ChunkLoader', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('the boot splash', () => {
        it('shows the boot stage inside the loading card', () => {
            render(<ChunkLoader variant='splash' progress={58} message='Loading your workspace...' />);

            expect(screen.getByTestId('dt_boot_splash')).toBeInTheDocument();
            expect(screen.getByRole('status')).toHaveTextContent('Loading your workspace...');
            expect(screen.getByText('58%')).toBeInTheDocument();
            expect(screen.getByText('Getting your trading hub ready.')).toBeInTheDocument();
        });

        it('moves the progress bar to the stage it was given', () => {
            const { container } = render(<ChunkLoader variant='splash' progress={86} message='Loading markets...' />);

            const fill = container.querySelector('.boot-card__bar-fill') as HTMLElement;
            expect(fill.style.width).toBe('86%');
        });

        it('clamps a stray progress value instead of overflowing the bar', () => {
            const { container } = render(<ChunkLoader variant='splash' progress={140} message='Booting...' />);

            expect(container.querySelector('.boot-card__bar-fill')).toHaveStyle({ width: '100%' });
            expect(screen.getByText('100%')).toBeInTheDocument();
        });

        it('highlights the stage dot the progress falls in', () => {
            const { container } = render(<ChunkLoader variant='splash' progress={86} message='Loading markets...' />);

            const dots = Array.from(container.querySelectorAll('.boot-card__dot'));
            expect(dots).toHaveLength(4);
            // 86% of the way through four stages puts the boot in the last one.
            expect(dots.map(dot => dot.classList.contains('boot-card__dot--active'))).toEqual([
                false,
                false,
                false,
                true,
            ]);
        });

        it('hands the pre-React cover over to itself once it has painted', () => {
            render(<ChunkLoader variant='splash' message='Connecting to the server...' />);

            expect(hideBootSplash).toHaveBeenCalledTimes(1);
        });
    });

    describe('the inline loader', () => {
        it('stays a plain spinner + message and leaves the cover alone', () => {
            const { container } = render(<ChunkLoader message='Please wait, loading tutorials...' />);

            expect(screen.getByText('Please wait, loading tutorials...')).toBeInTheDocument();
            expect(container.querySelector('.boot-card')).toBeNull();
            expect(hideBootSplash).not.toHaveBeenCalled();
        });
    });
});
