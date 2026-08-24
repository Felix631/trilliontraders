// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import './trading-view.scss';

/**
 * TradingView Advanced Chart Widget — full-featured chart with indicators,
 * drawing tools, chart types (candle, line, area, Heikin-Ashi, etc.) and
 * symbol search. Uses TradingView's official embed script.
 */
const TradingViewComponent = ({ symbol = 'DERIV:R_100' }: { symbol?: string }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const widgetKey = `tradingview_${React.useId()}`;

    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Clear any previous widget
        container.innerHTML = '';

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.type = 'text/javascript';
        script.async = true;
        script.innerHTML = JSON.stringify({
            autosize: true,
            symbol,
            interval: '1',
            timezone: 'Etc/UTC',
            theme: 'dark',
            style: '1',           // 1 = candlestick
            locale: 'en',
            backgroundColor: '#0f172a',
            gridColor: '#1e293b',
            allow_symbol_change: true,
            calendar: false,
            support_host: 'https://www.tradingview.com',
            toolbar_bg: '#0f172a',
            hide_top_toolbar: false,
            hide_side_toolbar: false,
            studies: [
                'MASimple@tv-basicstudies',
                'RSI@tv-basicstudies',
                'MACD@tv-basicstudies',
                'BB@tv-basicstudies',
                'StochasticRSI@tv-basicstudies',
                'ADX@tv-basicstudies',
            ],
            show_popup_button: true,
            popup_width: '1000',
            popup_height: '650',
            save_image: true,
            hide_volume: false,
            withdateranges: true,
            compareSymbols: [],
            details: true,
            hotlist: true,
            news: ['headlines'],
            watchlist: [],
            timezone: 'Etc/UTC',
        });

        container.appendChild(script);

        return () => {
            container.innerHTML = '';
        };
    }, [symbol]);

    return (
        <div className='trading-view-chart' ref={containerRef} key={widgetKey} />
    );
};

export default TradingViewComponent;
