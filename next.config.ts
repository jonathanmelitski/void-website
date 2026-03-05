import type { NextConfig } from "next"

const s3BaseUrl = process.env.NEXT_PUBLIC_S3_BASE_URL ?? ""

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      ...(s3BaseUrl
        ? [{ protocol: "https" as const, hostname: new URL(s3BaseUrl).hostname, pathname: "/events/**" }]
        : []),
    ],
  },
}

export default nextConfig
