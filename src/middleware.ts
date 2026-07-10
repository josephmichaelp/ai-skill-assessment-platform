import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './i18n';

export default createMiddleware({
  locales,
  defaultLocale,
  localeDetection: true,
});

export const config = {
  matcher: ['/', '/(id|en)/:path*'],
};
