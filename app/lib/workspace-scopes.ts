export type WorkspaceCatalog = {
  brands: string[];
  productsByBrand: Record<string, string[]>;
  brandIds: Record<string, string>;
  productIds: Record<string, string>;
};

export const brandScope = (catalog: WorkspaceCatalog, brand: string) => `brand:${catalog.brandIds[brand] || ""}`;
export const productScope = (catalog: WorkspaceCatalog, brand: string, product: string) => `product:${catalog.productIds[`${brand}/${product}`] || ""}`;

export function isWorkspaceScopeAllowed(catalog: WorkspaceCatalog, scopes: string[], brand: string, product?: string) {
  if (scopes.includes("*")) return true;
  const brandValue = brandScope(catalog, brand);
  if (brandValue !== "brand:" && scopes.includes(brandValue)) return true;
  if (!product) return catalog.productsByBrand[brand]?.some((item) => scopes.includes(productScope(catalog, brand, item))) || false;
  const productValue = productScope(catalog, brand, product);
  return productValue !== "product:" && scopes.includes(productValue);
}

export function normalizeWorkspaceScopes(catalog: WorkspaceCatalog, scopes: string[]) {
  if (scopes.includes("*")) return ["*"];
  const validBrands = new Set(catalog.brands.map((brand) => brandScope(catalog, brand)));
  const validProducts = new Set(catalog.brands.flatMap((brand) => (catalog.productsByBrand[brand] || []).map((product) => productScope(catalog, brand, product))));
  const normalized = scopes.flatMap((raw) => {
    const scope = raw.trim();
    if (validBrands.has(scope) || validProducts.has(scope)) return [scope];
    const brand = catalog.brands.find((item) => item === scope);
    if (brand) return [brandScope(catalog, brand)];
    for (const candidate of catalog.brands) {
      const product = (catalog.productsByBrand[candidate] || []).find((item) => `${candidate} / ${item}` === scope);
      if (product) return [productScope(catalog, candidate, product)];
    }
    return [];
  });
  return [...new Set(normalized)].filter((scope) => scope !== "brand:" && scope !== "product:");
}

export function describeWorkspaceScopes(catalog: WorkspaceCatalog, scopes: string[]) {
  if (scopes.includes("*")) return "全部品牌与产品";
  const labels: string[] = [];
  for (const brand of catalog.brands) {
    if (scopes.includes(brandScope(catalog, brand))) labels.push(brand);
    else for (const product of catalog.productsByBrand[brand] || []) if (scopes.includes(productScope(catalog, brand, product))) labels.push(`${brand} / ${product}`);
  }
  return labels.length ? labels.join("、") : "未授权品牌或产品";
}
