// Single seam for error reporting. Today it writes to the console; when the
// site gets a crash-reporting account (Sentry or similar), forward from here.

export function reportError(error, context = {}) {
  console.error('[tangent]', context, error);
}

export function installGlobalHandlers(target = globalThis) {
  target.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { where: 'window.onerror' });
  });
  target.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { where: 'unhandledrejection' });
  });
}
