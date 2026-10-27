/**
 * Pre-React boot splash handover.
 *
 * index.html inlines an #df-boot-splash cover: the same Aurora Deep canvas and
 * loading card that the React boot splash renders (src/components/loader/chunk-loader.tsx),
 * hidden with `data-done='1'`.
 *
 * The cover used to be hidden the moment this bundle executed, which left the
 * light page background showing until React's own splash painted. It now stays up
 * until that splash has painted and calls hideBootSplash(), so the app boots on one
 * unbroken loading screen; the timeout below is only a safety net in case React
 * never renders.
 */
const BOOT_SPLASH_SAFETY_TIMEOUT = 8000;

/** Hides the inline pre-React cover, if it is still up. */
export function hideBootSplash(): void {
    if (typeof document === 'undefined') return;
    document.getElementById('df-boot-splash')?.setAttribute('data-done', '1');
}

if (typeof window !== 'undefined') {
    window.setTimeout(hideBootSplash, BOOT_SPLASH_SAFETY_TIMEOUT);
}

export {};
