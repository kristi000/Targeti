
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth-constants';
 
const intlMiddleware = createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'sq'],
 
  // Used when no locale matches
  defaultLocale: 'en',
  pathnames: {
    '/': '/',
    '/shop/[shopId]': '/shop/[shopId]',
  }
});

export default function middleware(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return intlMiddleware(request);
}
 
export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(sq|en)/:path*']
};
