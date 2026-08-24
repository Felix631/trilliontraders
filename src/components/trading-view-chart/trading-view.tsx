import React from 'react';
import './trading-view.scss';

const TradingViewComponent = () => {
    return (
        <div className='trading-view-chart'>
            <iframe
                id='trading-view-iframe'
                title='TradingView chart'
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                src='https://charts.deriv.com/deriv?hide-signup=true'
            />
        </div>
    );
};

export default TradingViewComponent;
