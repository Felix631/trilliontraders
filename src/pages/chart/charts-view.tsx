// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import './charts-view.scss';

const ChartWrapper = React.lazy(() => import('./chart-wrapper'));

/**
 * Charts tab body with a provider switch:
 *  - Deriv Chart  — the app's native tick/contract chart (default)
 *  - TradingView  — full TradingView chart with all built-in indicators
 */
const ChartsView = ({ show_digits_stats }) => {
    const [provider, setProvider] = React.useState('deriv');

    return (
        <div className='charts-view'>
            <div className='charts-view__switch' role='tablist' aria-label={localize('Chart provider')}>
                <button
                    type='button'
                    role='tab'
                    aria-selected={provider === 'deriv'}
                    className={classNames('charts-view__option', { 'charts-view__option--active': provider === 'deriv' })}
                    onClick={() => setProvider('deriv')}
                >
                    {localize('Deriv Chart')}
                </button>
                <button
                    type='button'
                    role='tab'
                    aria-selected={provider === 'tradingview'}
                    className={classNames('charts-view__option', {
                        'charts-view__option--active': provider === 'tradingview',
                    })}
                    onClick={() => setProvider('tradingview')}
                >
                    {localize('TradingView')}
                </button>
            </div>
            <div className='charts-view__body'>
                {provider === 'deriv' ? (
                    <React.Suspense fallback={null}>
                        <ChartWrapper show_digits_stats={show_digits_stats} />
                    </React.Suspense>
                ) : (
                    <TradingViewComponent />
                )}
            </div>
        </div>
    );
};

export default ChartsView;
