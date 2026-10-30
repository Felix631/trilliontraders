import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL } from '@/components/shared';
import { botNotification } from '@/components/bot-notification/bot-notification';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useApiBase } from '@/hooks/useApiBase';
import { useLogout } from '@/hooks/useLogout';
import { useStore } from '@/hooks/useStore';
import { describeOAuthRedirectIssue, getOAuthRedirectUri, rememberAuthReturn } from '@/utils/auth-utils';
import { navigateToTransfer } from '@/utils/transfer-utils';
import { Localize } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import './header.scss';

const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid, setIsAuthorizing, authData } = useApiBase();
    const { client } = useStore() ?? {};
    const [authTimeout, setAuthTimeout] = useState(false);
    const is_account_regenerating = client?.is_account_regenerating || false;

    // Detect OAuth callback on mount (before App.tsx cleans up the URL).
    // When ?code=...&state=... is present the full auth flow can take 7-15 s
    // (token exchange → accounts fetch → OTP → WebSocket auth), so we must
    // suppress the short fallback timeout and keep the spinner throughout.
    const [isOAuthPending, setIsOAuthPending] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return Boolean(params.get('code') && params.get('state'));
    });

    const { data: activeAccount } = useActiveAccount({
        allBalanceData: client?.all_accounts_balance,
        directBalance: client?.balance,
    });

    const handleLogout = useLogout();

    // Clear OAuth-pending flag once the account is set (auth succeeded)
    // or after a generous timeout in case something goes wrong.
    useEffect(() => {
        if (!isOAuthPending) return;

        if (activeLoginid) {
            setIsOAuthPending(false);
            return;
        }

        // Safety net: give up after 30 s and let the normal flow decide
        const timer = setTimeout(() => setIsOAuthPending(false), 30_000);
        return () => clearTimeout(timer);
    }, [isOAuthPending, activeLoginid]);

    // Handle direct URL access with legacy token param
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const account_id = urlParams.get('account_id');
        if (account_id) {
            setIsAuthorizing(true);
        }
    }, [setIsAuthorizing]);

    // Fallback timeout: show login button if auth never resolves.
    // Suppressed during the OAuth callback flow (isOAuthPending = true).
    useEffect(() => {
        if (isOAuthPending) return;

        const timer = setTimeout(() => {
            if (isAuthorizing && !activeLoginid) {
                setAuthTimeout(true);
                setIsAuthorizing(false);
            }
        }, 5000);

        if (activeLoginid || !isAuthorizing) {
            if (authTimeout) setAuthTimeout(false);
            clearTimeout(timer);
        }

        return () => clearTimeout(timer);
    }, [isAuthorizing, activeLoginid, setIsAuthorizing, authTimeout, isOAuthPending]);

    /**
     * Deriv renders a rejected sign-in on ITS OWN error page, so a bad
     * redirect_uri never comes back here. Catch the predictable cases (and make
     * the exact string we send discoverable) before the browser leaves.
     */
    const canStartOAuth = useCallback(() => {
        const issue = describeOAuthRedirectIssue();
        if (issue) {
            botNotification(issue, undefined, { type: 'warning', autoClose: 30000 });
            return false;
        }
        console.info('[Deriv OAuth] redirect_uri sent to Deriv:', getOAuthRedirectUri());
        return true;
    }, []);

    const handleSignup = useCallback(async () => {
        try {
            if (!canStartOAuth()) return;
            setIsAuthorizing(true);
            // Deriv redirects back to the bare origin, so remember the tab we
            // are leaving from and let the callback restore it.
            rememberAuthReturn();
            const oauthUrl = await generateOAuthURL('registration');
            if (oauthUrl) {
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate OAuth URL for signup');
                setIsAuthorizing(false);
            }
        } catch (error) {
            console.error('Signup redirection failed:', error);
            setIsAuthorizing(false);
        }
    }, [canStartOAuth, setIsAuthorizing]);

    const handleLogin = useCallback(async () => {
        try {
            if (!canStartOAuth()) return;
            // Set authorizing state immediately when login is clicked
            setIsAuthorizing(true);

            // Remember the current tab so the post-login landing returns to it
            // instead of the default tab (Deriv drops the hash on redirect).
            rememberAuthReturn();

            // Generate OAuth URL with CSRF token and PKCE parameters
            const oauthUrl = await generateOAuthURL();

            if (oauthUrl) {
                // Redirect to OAuth URL
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate OAuth URL');
                setIsAuthorizing(false);
            }
        } catch (error) {
            console.error('Login redirection failed:', error);
            // Reset authorizing state if redirection fails
            setIsAuthorizing(false);
        }
    }, [canStartOAuth, setIsAuthorizing]);

    const handleTransfer = useCallback(() => {
        const transferCurrency = authData?.currency;
        if (!transferCurrency) {
            console.error('No currency available for transfer');
            return;
        }
        navigateToTransfer(transferCurrency);
    }, [authData?.currency]);

    // The transfer button is the one thing that sits in the middle of the bar: a
    // small pill of its own rather than part of the account cluster on the right.
    const renderTransferSection = useCallback(() => {
        if (!activeLoginid || is_account_regenerating) return null;

        return (
            <Button
                primary
                className='app-header__transfer'
                disabled={client?.is_logging_out || !authData?.currency}
                onClick={handleTransfer}
            >
                <Localize i18n_default_text='Transfer' />
            </Button>
        );
    }, [activeLoginid, is_account_regenerating, client?.is_logging_out, authData?.currency, handleTransfer]);

    const renderAccountSection = useCallback(() => {
        // The account switcher alone owns the far right, where the transfer button
        // used to sit: the chip (avatar + balance) is the last thing in the bar.
        if (activeLoginid && !is_account_regenerating) {
            return (
                <div className='auth-actions'>
                    <div className='account-info'>
                        <AccountSwitcher activeAccount={activeAccount} />
                    </div>
                </div>
            );
        }
        // Show login button only when fully settled (not during OAuth flow)
        if (!isOAuthPending && ((!is_account_regenerating && !isAuthorizing && !activeLoginid) || authTimeout)) {
            // Disable auth buttons until the OAuth app id is configured, so the
            // click handlers (which would otherwise log "Failed to generate OAuth
            // URL") never fire. The env-not-set toast explains why.
            const isAuthConfigured = Boolean(process.env.NEXT_PUBLIC_DERIV_APP_ID);
            return (
                <div className='auth-actions'>
                    <Button tertiary disabled={!isAuthConfigured} onClick={handleLogin}>
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button primary_light disabled={!isAuthConfigured} onClick={handleSignup}>
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
        // Default: Show spinner during loading states or when authorizing
        return (
            <div className='auth-actions auth-actions--loading'>
                <svg
                    className='auth-actions__spinner'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                >
                    <circle
                        cx='12'
                        cy='12'
                        r='10'
                        stroke='currentColor'
                        strokeWidth='2.5'
                        strokeLinecap='round'
                        strokeDasharray='31.416'
                        strokeDashoffset='10'
                    />
                </svg>
            </div>
        );
    }, [
        isAuthorizing,
        activeLoginid,
        client,
        activeAccount,
        authTimeout,
        is_account_regenerating,
        isOAuthPending,
        canStartOAuth,
        handleLogin,
        handleSignup,
    ]);

    if (client?.should_hide_header) return null;

    return (
        <>
            <Header
                className={clsx('app-header', {
                    'app-header--desktop': isDesktop,
                    'app-header--mobile': !isDesktop,
                })}
            >
                <Wrapper variant='left'>
                    <MobileMenu onLogout={handleLogout} />
                    <AppLogo />
                    <MenuItems />
                </Wrapper>
                <div className='app-header__center'>{renderTransferSection()}</div>
                <Wrapper variant='right'>{renderAccountSection()}</Wrapper>
            </Header>
        </>
    );
});

export default AppHeader;
