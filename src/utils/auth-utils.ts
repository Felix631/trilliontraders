/**
 * Utility functions for authentication-related operations
 */

/**
 * Session key holding the tab hash the user was on when they started the Deriv
 * OAuth round-trip. Deriv redirects back to the bare origin, so without this the
 * post-login landing always reset to the default tab. Written before the
 * redirect (see the header's Log in / Sign up handlers) and consumed once by
 * App.tsx when the token exchange succeeds.
 */
export const AUTH_RETURN_KEY = 'tt_auth_return_to';

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
