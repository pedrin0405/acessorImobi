import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.BASE_DOMAIN;
  if (!base) return [];
  return ["/", "/login"].map((p) => ({ url: `https://${base}${p}` }));
}
