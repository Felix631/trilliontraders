// Customizable header logo + app name for white-labeling. Renders on both desktop and
// mobile (next to the hamburger). The logo/name resolution lives in LogoMark: partner
// logo (public/logo.<ext>, written by the BFF at deploy time, or a live data URL pushed
// from the App Builder via PREVIEW_BRANDING) → letter-badge fallback; app name from the
// preview or the resolved deploy/build name.
import { MouseEvent } from 'react';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { LogoMark } from './LogoMark';
import './app-logo.scss';

export const AppLogo = () => {
    // `useStore()` is null until the root store finishes initialising (the
    // provider renders its children with a null context on the first pass), so
    // it must not be destructured here — the header renders immediately.
    const store = useStore();

    // The logo used to be a plain `<a href='/'>`, which is a full document load —
    // clicking it re-downloaded the whole app (and dropped the logged-in bot you
    // were mid-way through). It now selects the Dashboard tab in place: the URL
    // hash is rewritten through history so a manual refresh still lands there.
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        store?.dashboard?.setActiveTab?.(DBOT_TABS.DASHBOARD);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}#dashboard`);
    };

    return (
        <a href='#dashboard' className='app-header__logo' aria-label={localize('Home')} onClick={handleClick}>
            <LogoMark height={32} />
        </a>
    );
};
