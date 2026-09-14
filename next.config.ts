
import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
 
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Keep development chunks separate from production build output. Sharing
  // `.next` can leave the dev runtime referencing chunks replaced by `next build`.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
