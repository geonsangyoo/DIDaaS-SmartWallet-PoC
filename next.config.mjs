/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "pino-pretty",
    "@safe-global/sdk-starter-kit",
    "@safe-global/protocol-kit",
    "@safe-global/api-kit",
  ],
};

export default nextConfig;
