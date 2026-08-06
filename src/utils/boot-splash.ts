// Pre-React boot splash teardown. index.html renders an inline #df-boot-splash cover
// (maroon/gold brand canvas) that is hidden with `data-done='1'`. This module runs as
// soon as the app bundle executes — before React mounts — so the cover never lingers
// once JS is up. Mirrors the partner-deploy behavior (splash hidden on bundle eval).
if (typeof document !== 'undefined') {
    const el = document.getElementById('df-boot-splash');
    if (el) el.setAttribute('data-done', '1');
}

export {};
