/**
 * API Error Handler
 *
 * Keeps global runtime error reporting without mutating the browser fetch API.
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
