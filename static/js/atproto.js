// Progressive-enhancement ATProto ownership helpers.
// Uses atcute browser OAuth when available (via the import map); otherwise
// the page keeps working in anonymous/local-save mode.

const STORAGE_KEY = 'atproto-session';

export function getAtprotoSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

export function setAtprotoSession(session) {
    if (!session) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getAtprotoDid() {
    const s = getAtprotoSession();
    return s ? s.did : null;
}

export async function signInWithBluesky() {
    try {
        const { createAuthorizationUrl, finalizeAuthorization } = await import('@atcute/oauth-browser-client');
        const metadataUrl = `${window.location.origin}/client-metadata.json`;
        const url = await createAuthorizationUrl({
            scope: 'atproto repo:org.kibigia.town repo:org.kibigia.town.snapshot blob:*/*',
            clientMetadata: metadataUrl,
        });
        window.location.assign(url);
    } catch (err) {
        console.warn('atcute OAuth not available:', err);
        alert('Bluesky sign-in is not available in this build.');
    }
}

export async function handleAtprotoCallback() {
    if (!window.location.search.includes('code=')) return false;
    try {
        const { finalizeAuthorization } = await import('@atcute/oauth-browser-client');
        const session = await finalizeAuthorization(window.location.href);
        setAtprotoSession(session);
        // Clean the URL.
        window.history.replaceState({}, '', window.location.pathname);
        return true;
    } catch (err) {
        console.error('ATProto callback failed:', err);
        return false;
    }
}

export async function writeTownRecord(townId) {
    const session = getAtprotoSession();
    if (!session || !session.did) return null;
    try {
        const [{ Client }, { com }] = await Promise.all([
            import('@atcute/client'),
            import('@atcute/client').then(m => m).catch(() => ({})),
        ]);
        const client = new Client({ handler: session });
        const rkey = String(townId);
        await client.call(com.atproto.repo.putRecord, {
            repo: session.did,
            collection: 'org.kibigia.town',
            rkey,
            record: {
                $type: 'org.kibigia.town',
                townId: rkey,
                knot: window.location.host,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        return session.did;
    } catch (err) {
        console.warn('Failed to write town record:', err);
        return null;
    }
}