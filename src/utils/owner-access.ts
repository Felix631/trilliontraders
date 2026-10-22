/**
 * Owner-only capabilities — every path that lets a strategy leave the app.
 *
 * The library's strategies are meant to be *run* in the builder, not copied out
 * of it, so the export paths (Save → local file, Save → Google Drive, the load
 * modal storing a copy, and the Blockly "Download Block" context menu entry) are
 * closed by default. They only open for a signed-in account named in
 * `NEXT_PUBLIC_OWNER_LOGINIDS` — a comma-separated allowlist of Deriv login ids,
 * e.g.
 *
 *     NEXT_PUBLIC_OWNER_LOGINIDS="CR1234567,VRTC998877"
 *
 * With the variable unset *nobody* can export, which is the safe default. The
 * check is made against the authenticated account id, so the allowlist being
 * visible in the bundle does not open the door for anyone else: an id you do not
 * own is an id you cannot sign in with.
 *
 * Deliberately free of React / store imports so the vendored Blockly code can
 * import it too (see scratch/utils/index.js).
 */
export const OWNER_LOGINIDS: string[] = String(process.env.NEXT_PUBLIC_OWNER_LOGINIDS ?? '')
    .split(',')
    .map(loginid => loginid.trim().toUpperCase())
    .filter(Boolean);

/** True when the given Deriv login id is on the owner allowlist. */
export const isOwnerLoginid = (loginid?: string | null): boolean =>
    Boolean(loginid) && OWNER_LOGINIDS.includes(String(loginid).trim().toUpperCase());

/** True when an allowlist exists at all. */
export const hasOwnerAllowlist = (): boolean => OWNER_LOGINIDS.length > 0;

/** The active Deriv login id as the app stores it (account switcher / OAuth). */
export const getActiveLoginid = (): string => {
    try {
        return localStorage.getItem('active_loginid') || '';
    } catch {
        return '';
    }
};

/**
 * Non-React form of the check, for code that runs outside the store tree (the
 * Blockly context menu).
 */
export const canExportStrategies = (): boolean => isOwnerLoginid(getActiveLoginid());
