// Theme boot + toggle — externalized from templates/index.html so the CSP
// can drop 'unsafe-inline' scripts. Runs parser-blocking before <style>s and
// the first paint: applies the stored scheme (or the system preference) to
// <html data-theme> and syncs the color-scheme / theme-color metas. The
// toggle handler is delegated, so it works for #themeToggle even though this
// file executes before <body> exists.
(function () {
    var root = document.documentElement;
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var themeColorDark = '#141821';
    var themeColorLight = '#ffffff';

    function storedScheme() {
        try { return localStorage.getItem('color-scheme'); } catch (e) { return null; }
    }

    function resolvedScheme() {
        return storedScheme() || (media.matches ? 'dark' : 'light');
    }

    function apply(scheme) {
        root.setAttribute('data-theme', scheme);
        var meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute('content', storedScheme() || 'light dark');
        var tc = document.querySelector('meta[name="theme-color"]');
        if (tc) tc.setAttribute('content', scheme === 'dark' ? themeColorDark : themeColorLight);
    }

    // FOUC-safe boot: resolve before first paint
    apply(resolvedScheme());

    // Toggle click (delegated — #themeToggle is parsed after this script)
    document.addEventListener('click', function (event) {
        var toggle = event.target && event.target.closest ? event.target.closest('#themeToggle') : null;
        if (!toggle) return;
        var target = resolvedScheme() === 'dark' ? 'light' : 'dark';
        var system = media.matches ? 'dark' : 'light';
        try {
            // Undo the override when the target matches the system again
            if (target === system) localStorage.removeItem('color-scheme');
            else localStorage.setItem('color-scheme', target);
        } catch (e) { /* storage blocked: apply without persisting */ }
        apply(target);
    });

    // Follow OS scheme changes while no manual override is stored
    media.addEventListener('change', function () {
        if (!storedScheme()) apply(media.matches ? 'dark' : 'light');
    });

    // Keep tabs in sync when the override changes elsewhere
    window.addEventListener('storage', function (event) {
        if (event.key === 'color-scheme') apply(resolvedScheme());
    });
})();
