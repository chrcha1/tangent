// One place for outbound requests: a timeout, and failures normalised into a
// ServiceError whose `kind` says what went wrong.

export class ServiceError extends Error {
  constructor(message, { kind, status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'ServiceError';
    this.kind = kind; // 'network' | 'timeout' | 'http' | 'malformed' | 'empty'
    this.status = status;
  }
}

export async function getJson(url, { timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (cause) {
      const kind = controller.signal.aborted ? 'timeout' : 'network';
      throw new ServiceError(`Request failed (${kind})`, { kind, cause });
    }
    if (!response.ok) {
      throw new ServiceError(`Request failed (HTTP ${response.status})`, {
        kind: 'http',
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch (cause) {
      const kind = controller.signal.aborted ? 'timeout' : 'malformed';
      throw new ServiceError(`Unreadable response (${kind})`, { kind, cause });
    }
  } finally {
    clearTimeout(timer);
  }
}
