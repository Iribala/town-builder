// Server-embed globals — externalized from templates/index.html so the CSP
// can drop 'unsafe-inline' scripts. Reads the #server-embed JSON blob the
// index handler renders and republishes the values modules expect, before
// any ES module evaluates (classic scripts run to completion before modules).
(function () {
    var embed = {};
    try {
        var blob = document.getElementById('server-embed');
        if (blob && blob.textContent) embed = JSON.parse(blob.textContent);
    } catch (err) {
        console.error('server-embed: parse failed:', err);
        return;
    }
    if (embed.BasePath) window.__BASE_PATH = embed.BasePath;
    if (embed.Token) window.__TOKEN = embed.Token;
    if (embed.StaticVersion) window.__STATIC_VERSION__ = embed.StaticVersion;
})();
