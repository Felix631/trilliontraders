// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import './trading-view.scss';

/**
 * TradingView Advanced Chart — rendered through TradingView's official
 * widgetembed iframe. This is deterministic (no third-party script injection,
 * which ad-blockers/CSP can silently block) and ships the full chart:
 * indicators (MA/RSI/MACD/BB/Stoch), drawing tools, chart types, timeframes,
 * symbol search and date ranges.
 */

const DEFAULT_STUDIES = [
    'MASimple@tv-basicstudies',
    'RSI@tv-basicstudies',
    'MACD@tv-basicstudies',
];

const buildEmbedUrl = (symbol: string, studies: string[]): string => {
    const params = new URLSearchParams({
        symbol,
        interval: '1',
        theme: 'dark',
        style: '1', // candlestick — switchable inside the chart toolbar
        timezone: 'Etc/UTC',
        locale: 'en',
        toolbarbg: '#0f172a',
        // keep both toolbars: top (chart types/timeframes/indicators menu)
        // and side (drawing tools)
        hidetoptoolbar: '0',
        hidesidetoolbar: '0',
        allow_symbol_change: '1',
        withdateranges: '1',
        details: '1',
        hide_volume: '0',
        save_image: '1',
        utm_source: 'trilliontraders',
        utm_medium: 'widget',
    });
    if (studies.length) {
        params.set('studies', JSON.stringify(studies));
    }
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
};

const TradingViewComponent = ({
    symbol = 'BINANCE:BTCUSDT',
    className,
}: {
    /** Any valid TradingView symbol, e.g. "BINANCE:BTCUSDT", "FX:EURUSD". */
    symbol?: string;
    className?: string;
}) => {
    const [loaded, setLoaded] = React.useState(false);
    const src = React.useMemo(() => buildEmbedUrl(symbol, DEFAULT_STUDIES), [symbol]);

    return (
        <div className={classNames('trading-view-chart', className)}>
            {!loaded && (
                <div className='trading-view-chart__loading'>{localize('Loading TradingView chart…')}</div>
            )}
            <iframe
                title={localize('TradingView Advanced Chart')}
                src={src}
                onLoad={() => setLoaded(true)}
                allow='clipboard-write'
                allowFullScreen
                className='trading-view-chart__frame'
            />
        </div>
    );
};

export default TradingViewComponent;
