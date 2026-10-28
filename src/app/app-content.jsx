import React, { lazy, Suspense, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import AuthLoadingWrapper from '@/components/auth-loading-wrapper';
import { botNotification } from '@/components/bot-notification/bot-notification';
import useLiveChat from '@/components/chat/useLiveChat';
import ChunkLoader from '@/components/loader/chunk-loader';
import { getUrlBase } from '@/components/shared';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useBootProgress } from '@/hooks/useBootProgress';
import useDevMode from '@/hooks/useDevMode';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { bootProgress } from '@/stores/boot-progress-store';
import { isPreviewMode } from '@/utils/is-preview-mode';
import { ThemeProvider } from '@deriv-com/quill-ui';
import { setSmartChartsPublicPath } from '@deriv-com/smartcharts-champion';
import { localize } from '@deriv-com/translations';
import Audio from '../components/audio';
import BlocklyLoading from '../components/blockly-loading';
import BotStopped from '../components/bot-stopped';
import BotBuilder from '../pages/bot-builder';
import Main from '../pages/main';
import './app.scss';
import 'react-toastify/dist/ReactToastify.css';
import '../components/bot-notification/bot-notification.scss';

// App Builder live-preview branding listener. Mounted only in the preview deployment
// (NEXT_PUBLIC_APP_BUILD === 'true'); the inline check is constant-folded by rsbuild so
// the import — and all of src/preview/ — is dead-code-eliminated from standalone partner
// builds (where the BFF strips src/preview/ entirely).
const PreviewBranding =
    process.env.NEXT_PUBLIC_APP_BUILD === 'true' ? lazy(() => import('../preview/preview-branding')) : null;

const AppContent = observer(() => {
    const [is_api_initialized, setIsApiInitialized] = React.useState(false);
    const [is_loading, setIsLoading] = React.useState(true);
    const boot = useBootProgress();

    const store = useStore();
    const { app, transactions, common, client } = store;
    const { is_dark_mode_on } = useThemeSwitcher();

    const { recovered_transactions, recoverPendingContracts } = transactions;
    const is_subscribed_to_msg_listener = React.useRef(false);
    const msg_listener = React.useRef(null);
    const { connectionStatus } = useApiBase();

    // Initialize dev mode keyboard shortcuts
    useDevMode();

    // Deriv credentials are the only credentials this app accepts, and the whole
    // sign-in flow is built from the Deriv App ID. Warn (once, naming the exact
    // key) when it isn't configured, so "Log in" being disabled can never be
    // mistaken for a broken Deriv account. Skipped inside the App Builder static
    // preview, which intentionally runs without env vars.
    useEffect(() => {
        if (isPreviewMode()) return;
        if (!process.env.NEXT_PUBLIC_DERIV_APP_ID) {
            botNotification(
                localize(
                    'Deriv sign-in is disabled: NEXT_PUBLIC_DERIV_APP_ID is not set for this deployment. Add your Deriv App ID to the host environment variables and rebuild.'
                ),
                undefined,
                { type: 'warning', autoClose: 30000 }
            );
        }
    }, []);

    const livechat_client_information = {
        is_client_store_initialized: client?.is_logged_in ? true : !!client,
        is_logged_in: client?.is_logged_in,
        loginid: client?.loginid,
        currency: client?.currency,
        residence: client?.residence,
        email: '',
        first_name: '',
        last_name: '',
    };

    useLiveChat(livechat_client_information);

    // NOTE: Disabled Intercom until further notice
    // const token = V2GetActiveToken() ?? null;
    // useIntercom(token);

    useEffect(() => {
        if (connectionStatus === CONNECTION_STATUS.OPENED) {
            setIsApiInitialized(true);
            common.setSocketOpened(true);
        } else if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            common.setSocketOpened(false);
        }
    }, [common, connectionStatus]);

    const { current_language } = common;
    const html = document.documentElement;
    React.useEffect(() => {
        html?.setAttribute('lang', current_language.toLowerCase());
        html?.setAttribute('dir', current_language.toLowerCase() === 'ar' ? 'rtl' : 'ltr');
    }, [current_language, html]);

    const handleMessage = React.useCallback(
        ({ data }) => {
            if (data?.msg_type === 'proposal_open_contract' && !data?.error) {
                const { proposal_open_contract } = data;
                if (
                    proposal_open_contract?.status !== 'open' &&
                    !recovered_transactions?.includes(proposal_open_contract?.contract_id)
                ) {
                    recoverPendingContracts(proposal_open_contract);
                }
            }
        },
        [recovered_transactions, recoverPendingContracts]
    );

    React.useEffect(() => {
        setSmartChartsPublicPath(getUrlBase('/js/smartcharts/'));
    }, []);

    React.useEffect(() => {
        // Check if api is initialized and then subscribe to the api messages
        // Also we should only subscribe to the messages once user is logged in
        // And is not already subscribed to the messages
        if (!is_subscribed_to_msg_listener.current && client.is_logged_in && is_api_initialized && api_base?.api) {
            is_subscribed_to_msg_listener.current = true;
            msg_listener.current = api_base.api.onMessage()?.subscribe(handleMessage);
        }
        return () => {
            if (is_subscribed_to_msg_listener.current && msg_listener.current) {
                is_subscribed_to_msg_listener.current = false;
                msg_listener.current.unsubscribe?.();
            }
        };
    }, [is_api_initialized, client.is_logged_in, client.loginid, handleMessage, connectionStatus]);

    const init = () => {
        ServerTime.init(common);
        app.setDBotEngineStores();
        ApiHelpers.setInstance(app.api_helpers_store);
        import('@/utils/gtm').then(({ default: GTM }) => {
            GTM.init(store);
        });
    };

    const changeActiveSymbolLoadingState = () => {
        init();

        const retrieveActiveSymbols = () => {
            const { active_symbols } = ApiHelpers.instance;

            active_symbols.retrieveActiveSymbols(true).then(() => {
                setIsLoading(false);
            });
        };

        if (ApiHelpers?.instance?.active_symbols) {
            retrieveActiveSymbols();
        } else {
            // This is a workaround to fix the issue where the active symbols are not loaded immediately
            // when the API is initialized. Should be replaced with RxJS pubsub
            const intervalId = setInterval(() => {
                if (ApiHelpers?.instance?.active_symbols) {
                    clearInterval(intervalId);
                    retrieveActiveSymbols();
                }
            }, 1000);
        }
    };

    React.useEffect(() => {
        if (is_api_initialized) {
            init();
            setIsLoading(true);
            if (!client.is_logged_in) {
                changeActiveSymbolLoadingState();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_api_initialized]);

    React.useEffect(() => {
        if (client.is_logged_in && is_api_initialized) {
            changeActiveSymbolLoadingState();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_api_initialized, client.loginid]);

    // Everything is loaded: let the boot bar finish counting to 100% and sit there
    // for a beat. Until it does, the splash stays up — the app opens without it.
    const show_boot_splash = is_loading || !boot.done;

    React.useEffect(() => {
        if (!is_loading && !common?.error) bootProgress.finish();
    }, [is_loading, common?.error]);

    if (common?.error) return null;

    return (
        <React.Fragment>
            {PreviewBranding && (
                <Suspense fallback={null}>
                    <PreviewBranding />
                </Suspense>
            )}
            {show_boot_splash ? (
                <ChunkLoader variant='splash' stage='markets' />
            ) : (
                <AuthLoadingWrapper>
                    <ThemeProvider theme={is_dark_mode_on ? 'dark' : 'light'}>
                        <BlocklyLoading />
                        <div className='bot-dashboard bot' data-testid='dt_bot_dashboard'>
                            <Audio />
                            <Main />
                            <BotBuilder />
                            <BotStopped />
                            <TransactionDetailsModal />
                            <ToastContainer limit={3} draggable={false} />
                        </div>
                    </ThemeProvider>
                </AuthLoadingWrapper>
            )}
        </React.Fragment>
    );
});

export default AppContent;
