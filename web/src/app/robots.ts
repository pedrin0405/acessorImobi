import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.BASE_DOMAIN;
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/tenant", "/corretor", "/admin"] },
    ...(base ? { sitemap: `https://${base}/sitemap.xml` } : {}),
  };
}
