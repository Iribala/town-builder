/**
 * API Error Handler
 *
 * Keeps global runtime error reporting without mutating the browser fetch API.
 * Use apiFetch() instead of fetch() for API calls so that HTTP error responses
 * (4xx/5xx) are surfaced as notifications. fetch() itself never throws on HTTP
 * errors, so callers that omit a response.ok check would otherwise swallow them.
 */

import { showNotification } from './ui.js';

const HANDLER_FLAG = '__apiErrorHandlersInstalled';

if (!window[HANDLER_FLAG]) {
    window.addEventListener('unhandledrejection', event => {
        const message = event.reason?.message || 'Unhandled promise rejection';
        showNotification(message, 'error');
    });

    window.addEventListener('error', event => {
        const message = event.error?.message || event.message || 'Unhandled runtime error';
        showNotification(message, 'error');
    });

    window[HANDLER_FLAG] = true;
}

/**
 * fetch() wrapper that notifies the user and throws on HTTP error responses.
 * Drop-in replacement for fetch() at API call sites.
 *
 * @param {RequestInfo} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>} The successful response
 * @throws {Error} On network failure or non-2xx HTTP status
 */
export async function apiFetch(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        let message = `Error ${response.status}: ${response.statusText}`;
        try {
            const body = await response.clone().json();
            if (body?.detail) {
                message = typeof body.detail === 'string'
                    ? body.detail
                    : (body.detail.message || message);
            }
        } catch (_) { /* non-JSON body — keep the status message */ }
        showNotification(message, 'error');
        throw new Error(message);
    }
    return response;
}
