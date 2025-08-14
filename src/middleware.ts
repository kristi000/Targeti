
import createMiddleware from 'next-intl/middleware';
 
export default createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'sq'],
 
  // Used when no locale matches
  defaultLocale: 'en',
  pathnames: {
    '/': '/',
    '/shop/[shopId]': '/shop/[shopId]',
  }
});
 
export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(sq|en)/:path*']
};
