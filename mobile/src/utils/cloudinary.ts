import { API_BASE_URL } from './constants';

const SERVER_BASE = API_BASE_URL.replace('/api', '');

export const applyCloudinaryTransform = (
  url: string | undefined | null,
  width = 600,
  height = 600,
): string | null => {
  if (!url) return null;
  if (url.startsWith('/uploads/')) return `${SERVER_BASE}${url}`;
  if (
    url.includes('res.cloudinary.com') &&
    !url.includes('/upload/w_') &&
    !url.includes('/upload/c_')
  ) {
    return url.replace(
      '/upload/',
      `/upload/w_${width},h_${height},c_fill,g_subject,q_auto,f_auto/`,
    );
  }
  return url;
};

export const cloudinaryThumb = (url: string | undefined | null): string | null =>
  applyCloudinaryTransform(url, 100, 100);
