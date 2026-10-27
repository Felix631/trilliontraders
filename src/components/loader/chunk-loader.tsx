import { useEffect } from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { Loader } from '@deriv-com/ui';
import { hideBootSplash } from '@/utils/boot-splash';
import { getAppName } from '@/utils/branding';
import { LogoMark } from '@/components/layout/app-logo/LogoMark';
import './chunk-loader.scss';

/**
 * Boot screens.
 *
 * `variant='inline'` is the small spinner used by a page that is still fetching
 * its own data (charts, tutorials).
 *
 * `variant='splash'` is the boot cover: the same Aurora Deep canvas and loading
 * card the pre-React cover in index.html paints (see src/utils/boot-splash.ts),
 * so starting the app is one continuous screen. Every boot stage rides inside
 * this card and only the stage line and the bar move on, instead of the screen
 * swapping through three loose spinners ("please wait...", "Loading...",
 * "Initializing ... account...").
 */
type TChunkLoader = {
    message: string;
    variant?: 'inline' | 'splash';
    /** How far the boot has come, 0-100. Drives the bar, the shade and the stage dots. */
    progress?: number;
};

const STAGE_COUNT = 4;

const ChunkLoader = ({ message, variant = 'inline', progress = 20 }: TChunkLoader) => {
    // The React splash is the same card as the inline cover, so the cover can hand
    // over as soon as this has painted — and only when we actually are the splash.
    useEffect(() => {
        if (variant === 'splash') hideBootSplash();
    }, [variant]);

    if (variant === 'inline') {
        return (
            <div className='app-root'>
                <Loader />
                <div className='load-message'>{message}</div>
            </div>
        );
    }

    const percent = Math.max(0, Math.min(100, Math.round(progress)));
    const stage = Math.min(STAGE_COUNT - 1, Math.floor(percent / (100 / STAGE_COUNT)));

    return (
        <div className='app-root app-root--splash' data-testid='dt_boot_splash'>
            <div className='boot-card' role='status' aria-live='polite'>
                <div className='boot-card__brand'>
                    <LogoMark height={32} />
                    <span className='boot-card__live'>
                        <span className='boot-card__live-dot' aria-hidden='true' />
                        {localize('LIVE')}
                    </span>
                </div>

                <span className='boot-card__divider' aria-hidden='true' />

                <h1 className='boot-card__title'>{localize('Welcome to {{app}}', { app: getAppName() })}</h1>
                <p className='boot-card__subtitle'>
                    {localize('Synthetic indices, trading bots and live charts in one hub.')}
                </p>

                <div className='boot-card__progress'>
                    <span className='boot-card__bar' aria-hidden='true'>
                        <span className='boot-card__bar-fill' style={{ width: `${percent}%` }} />
                    </span>
                    <span className='boot-card__pct'>{percent}%</span>
                </div>

                <p className='boot-card__status'>{message}</p>

                <ul className='boot-card__features'>
                    {[localize('Trading bots'), localize('Live charts'), localize('Synthetic indices')].map(
                        feature => (
                            <li key={feature} className='boot-card__feature'>
                                {feature}
                            </li>
                        )
                    )}
                </ul>

                <span className='boot-card__dots' aria-hidden='true'>
                    {Array.from({ length: STAGE_COUNT }, (_, index) => (
                        <span
                            key={index}
                            className={classNames('boot-card__dot', {
                                'boot-card__dot--active': index === stage,
                            })}
                        />
                    ))}
                </span>

                <p className='boot-card__footer'>{localize('Getting your trading hub ready.')}</p>
            </div>
        </div>
    );
};

export default ChunkLoader;
