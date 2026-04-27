import axios from 'axios';
import i18n from '../i18n';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

function acceptLanguageHeader(): string {
  const lng = i18n.language || localStorage.getItem('sprouts_locale') || 'zh-CN';
  return lng.startsWith('en') ? 'en' : 'zh-CN';
}

// Add a request interceptor to include the JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sprouts_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.headers['Accept-Language'] = acceptLanguageHeader();
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle unauthorized errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('sprouts_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
