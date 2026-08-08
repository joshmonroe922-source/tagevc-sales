import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // PassKit signing uses node-forge / native crypto paths — keep out of the bundler.
  serverExternalPackages: ['passkit-generator'],
};

export default nextConfig;
