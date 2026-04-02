/**
 * Minimal API client for standalone video editor — no authentication.
 */
const API_CONFIG = {
  baseUrl: '/api',
  timeout: 120000,
  retryAttempts: 2,
  retryDelay: 800
};

class APIService {
  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
    this.timeout = API_CONFIG.timeout;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const requestTimeout = options.timeout || this.timeout;
    const { headers: optHeaders, ...rest } = options;
    const headers = {
      ...(optHeaders || {})
    };
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let lastError;
    for (let attempt = 1; attempt <= API_CONFIG.retryAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);
      try {
        const response = await fetch(url, {
          ...rest,
          headers,
          signal: controller.signal
        });

        if (!response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errData = await response.json();
            const err = new Error(errData.message || `HTTP ${response.status}`);
            err.apiError = true;
            throw err;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      } catch (err) {
        lastError = err;
        if (attempt >= API_CONFIG.retryAttempts || options.noRetry) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, API_CONFIG.retryDelay * attempt));
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw lastError;
  }

  /**
   * Stub: standalone editor has no global asset library.
   */
  async listAllAssets(_filters) {
    return {
      items: [],
      data: { items: [] },
      has_more: false,
      page: 1
    };
  }
}

window.apiService = new APIService();
