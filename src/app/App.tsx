import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import { cleanupUrl, handleOAuthCallback } from '@/external/deriv-core';
import { botNotification } from '@/components/bot-notification/bot-notification';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { StoreProvider } from '@/hooks/useStore';
import { consumeAuthReturn, getOAuthRedirectUri } from '@/utils/auth-utils';
import { isPreviewMode, PREVIEW_BASE_PATH } from '@/utils/is-preview-mode';
import { localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import i18nInstance from './i18n';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));

/**
 * Component wrapper to handle language URL parameter
 * Uses the useLanguageFromURL hook to process language switching
 */
const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

// The static preview build is served under /bot/preview (see rsbuild.config.ts
// assetPrefix), so React Router must resolve routes under that prefix. Standalone
// partner deploys are served at the root, so no basename there.
const routerBasename = isPreviewMode() ? PREVIEW_BASE_PATH : undefined;

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <LanguageHandler>
                            <StoreProvider>
                                <LocalStorageSyncWrapper>
                                    <RoutePromptDialog />
                                    <CoreStoreProvider>
                                        <Layout />
                                    </CoreStoreProvider>
                                </LocalStorageSyncWrapper>
                            </StoreProvider>
                        </LanguageHandler>
                    </TranslationProvider>
                </Suspense>
            }
        >
            {/* All child routes will be passed as children to Layout */}
            <Route index element={<AppRoot />} />
            {/* App Builder embeds the template at /preview — render the same app shell */}
            <Route path='preview' element={<AppRoot />} />
        </Route>
    ),
    { basename: routerBasename }
);

/**
 * Main App component
 *
 * Responsibilities:
 * 1. OAuth callback handling (via vendored deriv-core handleOAuthCallback)
 * 2. Account switching from URL (via useAccountSwitching hook)
 * 3. Router provider setup
 */
function App() {
    // Handle account switching via URL parameter
    useAccountSwitching();

    React.useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);

        // The ToastContainer is declared inside the lazily-loaded app shell, so hop
        // out of this task before notifying — a toast dispatched before anything is
        // listening for it is silently dropped.
        const reportFailure = (reason: string) =>
            setTimeout(
                () =>
                    botNotification(`${localize('Deriv sign-in failed')}: ${reason}`, undefined, {
                        type: 'error',
                        autoClose: 30000,
                    }),
                600
            );

        // Deriv answers a refused consent / bad client with `error` params on the
        // redirect instead of `code`. Those responses used to be ignored outright,
        // which made a rejected Deriv login look like a button that does nothing.
        const oauth_error = urlParams.get('error');
        if (oauth_error) {
            const description = urlParams.get('error_description');
            reportFailure(`${oauth_error}${description ? ` — ${description}` : ''}`);
            cleanupUrl(window.location.origin);
            return;
        }

        if (!urlParams.has('code')) return;

        const handleCallback = async () => {
            let authenticated = false;
            try {
                // Deriv credentials are the only credentials this app accepts: the
                // code below exchanges Deriv's own OAuth code for a trading token.
                const clientId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '';
                if (!clientId) {
                    throw new Error(
                        localize(
                            'NEXT_PUBLIC_DERIV_APP_ID is not set for this deployment, so the Deriv App ID could not be sent with the sign-in request.'
                        )
                    );
                }

                const authInfo = await handleOAuthCallback(window.location.href, {
                    clientId,
                    // Byte-identical to the redirect_uri on the authorization
                    // request, or Deriv refuses the exchange.
                    redirectUri: getOAuthRedirectUri(),
                    scopes: 'trade',
                });

                const { DerivWSAccountsService } = await import('@/services/derivws-accounts.service');
                const accounts = await DerivWSAccountsService.fetchAccountsList(authInfo.access_token);

                if (!accounts || accounts.length === 0) {
                    throw new Error(
                        localize('Deriv accepted the sign-in but returned no trading account for it.')
                    );
                }

                DerivWSAccountsService.storeAccounts(accounts);
                const firstAccount = accounts[0];
                localStorage.setItem('active_loginid', firstAccount.account_id);
                const isDemo =
                    firstAccount.account_id.startsWith('VRT') || firstAccount.account_id.startsWith('VRTC');
                localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

                const { api_base } = await import('@/external/bot-skeleton');
                await api_base.init(true);
                authenticated = true;
            } catch (error) {
                console.error('OAuth callback error:', error);
                // Previously this was console-only, which is why a failed Deriv
                // sign-in looked like a no-op in the UI.
                reportFailure(error instanceof Error ? error.message : String(error));
            } finally {
                // `cleanupUrl` drops every OAuth query param AND the hash, so it
                // has to run first — the return target below is set after it.
                cleanupUrl(window.location.origin);
            }

            if (authenticated) {
                // Deriv redirects back to the bare origin, so the tab the user
                // left from is gone by now. Restore it (falling back to the
                // Dashboard) and reload once: the app shell reads the tab from
                // the hash during its first render (see pages/main), so a
                // hash-only change would otherwise be ignored.
                const return_hash = consumeAuthReturn() || '#dashboard';
                window.history.replaceState(
                    window.history.state,
                    '',
                    `${window.location.pathname}${return_hash}`
                );
                window.location.reload();
            }
        };

        handleCallback();
    }, []);

    return <RouterProvider router={router} />;
}

export default App;
