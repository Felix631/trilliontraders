import { useEffect } from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { Loader } from '@deriv-com/ui';
import { useBootProgress } from '@/hooks/useBootProgress';
import { bootProgress, type TBootStage } from '@/stores/boot-progress-store';
import { hideBootSplash } from '@/utils/boot-splash';
import { getAppName } from '@/utils/branding';
import { LogoMark } from '@/components/layout/app-logo/LogoMark';
import './chunk-loader.scss';

/**
 * Boot screens.
 *
 * `variant='inline'` is the small spinner used by a page that is still fetching its
 * own data (charts, tutorials).
 *
 * `variant='splash'` is the one boot screen: the same Aurora Deep canvas and loading
 * card the pre-React cover in index.html paints (see src/utils/boot-splash.ts). Every
 * boot stage reports into this single card — it lists the stages it will go through,
 * ticks one behind as they pass, and counts the percentage up to 100 in one unbroken
 * bar (src/stores/boot-progress-store.ts) instead of swapping screens.
 */
type TChunkLoader = {
    /** Text for the inline variant. */
    message?: string;
    variant?: 'inline' | 'splash';
    /** Which boot stage this screen reports. */
    stage?: TBootStage;
};

const ChunkLoader = ({ message = '', variant = 'inline', stage = 'connecting' }: TChunkLoader) => {
    const { percent, stage: current_stage } = useBootProgress();

    // The React splash is the same card as the inline cover, so the cover can hand
    // over as soon as this has painted — and only when we actually are the splash.
    useEffect(() => {
        if (variant !== 'splash') return;
        hideBootSplash();
        bootProgress.startStage(stage);
    }, [variant, stage]);

    if (variant === 'inline') {
        return (
            <div className='app-root'>
                <Loader />
                <div className='load-message'>{message}</div>
            </div>
        );
    }

    const steps: { stage: TBootStage; label: string }[] = [
        { stage: 'connecting', label: localize('Connecting to the server') },
        { stage: 'workspace', label: localize('Loading your workspace') },
        { stage: 'markets', label: localize('Loading markets and your account') },
    ];

    const current_index = steps.findIndex(step => step.stage === current_stage);
    const step_state = (index: number) => {
        if (current_stage === 'ready' || index < current_index) return 'done';
        return index === current_index ? 'current' : 'pending';
    };

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
                    <span className='boot-card__pct' data-testid='dt_boot_percent'>
                        {percent}%
                    </span>
                </div>

                <ul className='boot-card__steps'>
                    {steps.map((step, index) => {
                        const state = step_state(index);

                        return (
                            <li key={step.stage} className={classNames('boot-card__step', `boot-card__step--${state}`)}>
                                <span className='boot-card__step-mark' aria-hidden='true'>
                                    {state === 'done' ? '✓' : ''}
                                </span>
                                <span className='boot-card__step-label'>{step.label}</span>
                            </li>
                        );
                    })}
                </ul>

                <p className='boot-card__footer'>
                    {current_stage === 'ready'
                        ? localize('Ready — opening your trading hub...')
                        : localize('Getting your trading hub ready.')}
                </p>
            </div>
        </div>
    );
};

export default ChunkLoader;
