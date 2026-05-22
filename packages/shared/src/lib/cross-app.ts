const stripTrailingSlash = (url: string) => url.replace(/\/$/, "");
const ensureLeadingSlash = (path: string) => (path.startsWith("/") ? path : `/${path}`);

const join = (base: string | undefined, path: string, fallback: string) => {
  const root = stripTrailingSlash(base?.trim() || fallback);
  if (!path) return root;
  return `${root}${ensureLeadingSlash(path)}`;
};

export const getWebsiteUrl = (path = "") =>
  join(process.env.NEXT_PUBLIC_WEBSITE_URL, path, "http://localhost:3001");

export const getCmsUrl = (path = "") =>
  join(process.env.NEXT_PUBLIC_CMS_URL, path, "http://localhost:3002");

export const getErpUrl = (path = "") =>
  join(process.env.NEXT_PUBLIC_ERP_URL, path, "http://localhost:3003");
