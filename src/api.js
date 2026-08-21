import { auth } from './firebase';

const DEFAULT_API_BASE_URL =
  'https://alertu-server-production.up.railway.app';

// Accept:
//   VITE_API_URL=https://alertu-server-production.up.railway.app
//   VITE_API_URL=https://alertu-server-production.up.railway.app/api
//   VITE_API_URL=/api
// and normalize the API prefix exactly once.
const configuredBaseUrl = (
  import.meta.env?.VITE_API_URL || DEFAULT_API_BASE_URL
).trim();

const withoutTrailingSlashes = configuredBaseUrl.replace(/\/+$/, '');

const BASE_URL = /\/api$/i.test(withoutTrailingSlashes)
  ? withoutTrailingSlashes
  : `${withoutTrailingSlashes}/api`;

const waitForAuthInit = () => {
  return new Promise((resolve) => {
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }

    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
};

const normalizeEndpoint = (endpoint) => {
  const value = String(endpoint || '').trim();
  const withoutLeadingSlashes = value.replace(/^\/+/, '');

  // Callers may pass either `/citizens` or `/api/citizens`.
  return withoutLeadingSlashes.replace(/^api\//i, '');
};

const getFirebaseToken = async (forceRefresh = false) => {
  const user = auth.currentUser || (await waitForAuthInit());

  if (!user) {
    return null;
  }

  try {
    const token = await user.getIdToken(forceRefresh);
    localStorage.setItem('authToken', token);
    return token;
  } catch (error) {
    console.error('Failed to retrieve Firebase ID token:', error);
    return localStorage.getItem('authToken');
  }
};

export const fetchFromBackend = async (endpoint, options = {}) => {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const url = `${BASE_URL}/${normalizedEndpoint}`;
  const token = await getFirebaseToken(false);

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // Refresh once if Firebase returned an expired token.
  if (
    (response.status === 401 || response.status === 403) &&
    auth.currentUser
  ) {
    const refreshedToken = await getFirebaseToken(true);

    if (refreshedToken) {
      response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          Authorization: `Bearer ${refreshedToken}`,
        },
      });
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('authToken');
    }

    let detail = '';

    try {
      const body = await response.json();
      detail = body?.message || body?.error || '';
    } catch (_) {
      // Keep the status error when the backend response is not JSON.
    }

    throw new Error(
      `HTTP ${response.status}: ${
        detail || response.statusText || 'Request failed'
      }`,
    );
  }

  return response.json();
};

export { BASE_URL };