export const COUNTRY_CACHE_KEY = 'client.country';

/** Two-letter ISO code (lowercase) or '' when it cannot be resolved. */
export const normalizeCountryCode = (value?: string | null) => {
    const code = String(value ?? '')
        .trim()
        .toLowerCase();
    return /^[a-z]{2}$/.test(code) ? code : '';
};

/**
 * A stale build used to write the string "undefined" here, so anything that is
 * not a real two-letter code is ignored.
 */
export const readCachedCountryCode = () => {
    try {
        return normalizeCountryCode(localStorage.getItem(COUNTRY_CACHE_KEY));
    } catch {
        return '';
    }
};

export const cacheCountryCode = (code: string) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return;
    try {
        localStorage.setItem(COUNTRY_CACHE_KEY, normalized);
    } catch {
        /* private mode — the flag simply refetches next time */
    }
};

/**
 * Resolves the client's country for the flag in the header.
 *
 * `get_settings` carries the account's own country, which is what the account
 * switcher should reflect. Accounts that cannot call it (OTP-only sessions on
 * some landing companies) fall back to `website_status.clients_country`, which
 * every connection can read.
 */
export const fetchClientCountryCode = async (api: any): Promise<string> => {
    if (!api?.send) return '';

    try {
        const settings_response = await api.send({ get_settings: 1 });
        const settings_code = normalizeCountryCode(settings_response?.get_settings?.country_code);
        if (settings_code) return settings_code;
    } catch {
        /* fall through to website_status */
    }

    try {
        const status_response = await api.send({ website_status: 1 });
        const status_code = normalizeCountryCode(status_response?.website_status?.clients_country);
        if (status_code) return status_code;
    } catch {
        /* no country available */
    }

    return '';
};

/** Human-readable country name, e.g. "Nigeria" for "ng". */
export const getCountryName = (code: string) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return '';
    try {
        const display_names = new (Intl as any).DisplayNames(['en'], { type: 'region' });
        return display_names?.of(normalized.toUpperCase()) ?? normalized.toUpperCase();
    } catch {
        return normalized.toUpperCase();
    }
};

/** Flag emoji used when the flag image cannot be loaded. */
export const getCountryEmoji = (code: string) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return '';
    return String.fromCodePoint(
        ...normalized.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0))
    );
};
