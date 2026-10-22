/**
 * Utility functions for authentication-related operations
 */
import { localize } from '@deriv-com/translations';

/**
 * Session key holding the tab hash the user was on when they started the Deriv
 * OAuth round-trip. Deriv redirects back to the bare origin, so without this the
 * post-login landing always reset to the default tab. Written before the
 * redirect (see the header's Log in / Sign up handlers) and consumed once by
 * App.tsx when the token exchange succeeds.
 */
export const AUTH_RETURN_KEY = 'tt_auth_return_to';

/**
 * The single `redirect_uri` used by the whole OAuth flow.
 *
 * Deriv demands this value be byte-identical on the authorization request and on
 * the token exchange, and it must exactly match one of the redirect URLs
 * pre-registered on the OAuth client — trailing slashes, scheme, host, port and
 * any path all count. It is therefore sent VERBATIM and never normalised here;
 * set `NEXT_PUBLIC_DERIV_REDIRECT_URI` to the exact registered string when it is
 * not simply the site's own origin (e.g. `https://yourapp.com/callback`).
 *
 * Deriv answers a mismatch with `error=invalid_request` on its own error page
 * (`home.deriv.com/dashboard/error`) describing that the redirect_uri does not
 * match the client's pre-registered urls — a dead end that never returns to this
 * app, which is why the pre-flight check below exists.
 */
export const getOAuthRedirectUri = (): string => {
    const configured = (process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI || '').trim();
    return configured || window.location.origin;
};

/**
 * Best-effort pre-flight check for the `redirect_uri`, run before the browser is
 * sent to Deriv.
 *
 * The registered list lives in the Deriv dashboard, so it cannot be read from
 * here — but the one rule Deriv states outright (*"HTTPS enabled on your redirect
 * URL. For local development you can use http://localhost"*) is predictable, and
 * a redirect that lands somewhere other than this page is worth saying out loud
 * before the user leaves.
 *
 * @returns a warning to show the user, or null when the flow can proceed.
 */
export const describeOAuthRedirectIssue = (): string | null => {
    const redirect_uri = getOAuthRedirectUri();

    let url: URL;
    try {
        url = new URL(redirect_uri);
    } catch {
        return localize(
            'Deriv sign-in cannot start: "{{uri}}" is not a valid URL. Set NEXT_PUBLIC_DERIV_REDIRECT_URI to the exact redirect URL registered on your Deriv app.',
            { uri: redirect_uri }
        );
    }

    const is_localhost = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
    if (url.protocol !== 'https:' && !is_localhost) {
        return localize(
            'Deriv sign-in cannot start: the redirect URL "{{uri}}" is not HTTPS. Deriv only accepts HTTPS redirect URLs (localhost is exempt), so register an HTTPS URL on your Deriv app and set NEXT_PUBLIC_DERIV_REDIRECT_URI to it.',
            { uri: redirect_uri }
        );
    }

    // The redirect will hand the user to a different origin than the one they are
    // browsing. That is legitimate (e.g. a registered /callback page), but it is
    // also the most common way to end up on Deriv's error page, so warn first.
    if (url.origin !== window.location.origin) {
        return localize(
            'Deriv sign-in will return to "{{uri}}", which is a different site from "{{origin}}". If Deriv reports that the redirect_uri does not match your client, register "{{uri}}" on your Deriv app and rebuild with that exact value.',
            { uri: redirect_uri, origin: window.location.origin }
        );
    }

    return null;
};

/** Remember the current tab hash so the OAuth redirect can return to it. */
export const rememberAuthReturn = () => {
    try {
        sessionStorage.setItem(AUTH_RETURN_KEY, window.location.hash || '');
    } catch {
        // Private-mode storage failures must never block the sign-in redirect.
    }
};

/** Read (and clear) the remembered tab hash, if any. */
export const consumeAuthReturn = (): string => {
    try {
        const value = sessionStorage.getItem(AUTH_RETURN_KEY) || '';
        sessionStorage.removeItem(AUTH_RETURN_KEY);
        return value;
    } catch {
        return '';
    }
};

/**
 * Clears authentication data from local storage and reloads the page
 */
export const clearAuthData = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('client.country');
    localStorage.removeItem('account_type'); // Clear account type when clearing auth data
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('callback_token');
};
