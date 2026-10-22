/**
 * The floating AI market scan has to be draggable all the way to either edge of
 * the screen: the pill is the drag handle, and the wider panel slides sideways
 * instead of holding the drag short of the edge.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ILoveYouAI from '../i-love-you-ai';

jest.mock('@/hooks/useMarketFeed', () => ({
    useMarketFeed: () => ({
        status: 'connecting',
        error: null,
        history: {},
        quotes: {},
        quote_history: {},
        rescan: jest.fn(),
    }),
}));

// jsdom has no PointerEvent, so hand React a MouseEvent under the pointer name:
// the handlers only read clientX/clientY, and this is the same event the browser
// delivers for a mouse drag.
const pointer = (element: Element, type: string, clientX: number, clientY: number) =>
    fireEvent(
        element,
        new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 })
    );

const set_element_size = (width: number, height: number) => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
            return width;
        },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
            return height;
        },
    });
};

describe('the floating AI market scan', () => {
    beforeEach(() => {
        localStorage.clear();
        set_element_size(240, 44);
    });

    it('drags the pill to the right end of the screen', () => {
        const { container } = render(<ILoveYouAI />);
        const root = container.firstElementChild as HTMLElement;
        const pill = screen.getByRole('button', { name: /AI market scan/ });

        pointer(pill, 'pointerdown', 100, 500);
        pointer(pill, 'pointermove', 4000, 500);

        // The clamp is the pill's own width, not the panel's, so the widget
        // actually reaches the edge instead of stopping 340px short of it.
        expect(root.style.left).toBe(`${window.innerWidth - 240}px`);
        expect(parseFloat(root.style.left)).toBeGreaterThan(window.innerWidth - 300);
    });

    it('slides the open panel left so it stays on screen at the right edge', () => {
        const { container } = render(<ILoveYouAI />);
        const root = container.firstElementChild as HTMLElement;
        const pill = screen.getByRole('button', { name: /AI market scan/ });

        pointer(pill, 'pointerdown', 100, 500);
        pointer(pill, 'pointermove', 4000, 500);
        pointer(pill, 'pointerup', 4000, 500);

        const panel = root.querySelector('.ilyai__panel') as HTMLElement;
        const offset = parseFloat(panel.style.left);
        const left = parseFloat(root.style.left) + offset;

        // The panel hangs off the widget's left edge by default; here it is
        // shifted so its right edge lands inside the viewport.
        expect(offset).toBeLessThan(0);
        expect(left + 340).toBeLessThanOrEqual(window.innerWidth);
        expect(left).toBeGreaterThanOrEqual(0);
    });
});
