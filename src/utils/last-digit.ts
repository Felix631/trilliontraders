/**
 * Last-digit helpers matching Deriv's digit-contract settlement.
 *
 * Deriv transmits quotes as JSON numbers, so trailing zeros are lost on the
 * wire ("812.40" arrives as 812.4). The true last digit is defined by the
 * price formatted to the symbol's pip size (its decimal places), e.g.
 * Volatility 100 (pip 0.01): 812.4 → "812.40" → digit 0.
 */

/** Decimals implied by a pip step such as 0.001 → 3 (handles "1e-4"). */
export const decimalsFromPipStep = (step: number | string): number | null => {
    const value = Number(step);
    if (!Number.isFinite(value) || value <= 0) return null;
    const s = String(value);
    if (s.includes('e-')) return Number(s.split('e-')[1]);
    const decimals = s.split('.')[1];
    return decimals ? decimals.length : 0;
};

/** Last digit of a quote formatted to `pip` decimal places — the digit a
 *  digit-contract settles on. Falls back to the raw string when the pip size
 *  is unknown. */
export const lastDigitOfQuote = (
    quote: number | string,
    pip: number | null | undefined
): number => {
    if (pip != null && Number.isFinite(pip)) {
        const formatted = Number(quote).toFixed(pip);
        return Number(formatted[formatted.length - 1]);
    }
    const s = String(quote);
    return Number(s[s.length - 1]);
};
