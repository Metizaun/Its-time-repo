export type CommercialCategory = "lenses" | "frames" | "services";
export type CommercialProduct = {
  id: string;
  category: CommercialCategory;
  catalogGroupId: string | null;
  catalogGroupName: string | null;
  lensCategory: "single_vision" | "multifocal" | null;
  sku: string | null;
  displayName: string;
  brand: string | null;
  treatments: string[];
  description: string | null;
  priceCents: number;
  priceKind: "exact" | "starting_at";
  currency: "BRL";
  isActive: boolean;
  images: Array<{ id: string; fileName: string; previewUrl?: string | null; visible: boolean }>;
};

export type CommercialRequest = {
  action: "none" | "search";
  category: CommercialCategory | null;
  lensCategory: "single_vision" | "multifocal" | null;
  brand: string | null;
  query: string | null;
  treatment: string | null;
  priceCents: number | null;
  priceMode: "near" | "maximum" | null;
};

export type CommercialResult = {
  status: "ignored" | "exact" | "alternatives" | "empty";
  products: CommercialProduct[];
  request: CommercialRequest;
};

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function restrictCommercialCatalog(
  products: CommercialProduct[],
  groupIds: ReadonlySet<string>,
  uncategorizedTypes: ReadonlySet<CommercialCategory>,
  imageIds: ReadonlySet<string>,
) {
  return products.filter((product) =>
    product.catalogGroupId ? groupIds.has(product.catalogGroupId) : uncategorizedTypes.has(product.category))
    .map((product) => ({
    ...product,
    images: product.images.filter((image) => image.visible && imageIds.has(image.id)),
  }));
}

export function searchCommercialCatalog(products: CommercialProduct[], request: CommercialRequest): CommercialResult {
  if (request.action === "none") return { status: "ignored", products: [], request };
  let matches = products.filter((item) => item.isActive && (!request.category || item.category === request.category));
  if (request.lensCategory) matches = matches.filter((item) => item.lensCategory === request.lensCategory);
  if (request.brand) matches = matches.filter((item) => item.brand && normalized(item.brand).includes(normalized(request.brand!)));
  if (request.query) {
    const query = normalized(request.query);
    matches = matches.filter((item) => normalized([item.sku, item.displayName, item.brand, item.description, item.catalogGroupName].filter(Boolean).join(" ")).includes(query));
  }
  if (request.priceCents !== null && request.priceMode === "maximum") {
    matches = matches.filter((item) => item.priceCents <= request.priceCents!);
  }
  const treatmentMatches = request.treatment
    ? matches.filter((item) => item.treatments.some((treatment) => normalized(treatment).includes(normalized(request.treatment!))))
    : matches;
  const candidates = treatmentMatches.length > 0 ? treatmentMatches : matches;
  candidates.sort((left, right) => request.priceCents !== null
    ? Math.abs(left.priceCents - request.priceCents) - Math.abs(right.priceCents - request.priceCents)
      || left.priceCents - right.priceCents
    : left.priceCents - right.priceCents || left.displayName.localeCompare(right.displayName));
  return { status: candidates.length === 0 ? "empty" : treatmentMatches.length === 0 ? "alternatives" : "exact",
    products: candidates.slice(0, 3), request };
}
