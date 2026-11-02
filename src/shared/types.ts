export type Cents = number;
export type CountryId = number;

export type Condition = 'MT' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL' | 'PO';
export type Finish = 'nonfoil' | 'foil' | 'etched';
export type BuyMode = 'cheapest-playable' | 'deck-as-listed';
export type PlanVariant = 'cheapest' | 'fewer-orders' | 'fastest';

export type BoardName =
  | 'mainboard'
  | 'commanders'
  | 'companions'
  | 'sideboard'
  | 'maybeboard'
  | 'tokens'
  | 'signatureSpells'
  | 'attractions'
  | 'stickers'
  | 'contraptions'
  | 'planes'
  | 'schemes';

export interface Seller {
  id: string;
  name: string;
  country: string;
  countryId: CountryId;
  isCommercial: boolean;
  isPowerseller: boolean;
  salesCount?: number;
  rating?: number;
  etaDays?: number | null;
}

export interface Offer {
  id: string;
  wantId: string;
  productId?: number;
  productName: string;
  expansion?: string;
  condition: Condition;
  language: 'EN';
  finish: Finish;
  isSigned: boolean;
  isAltered: boolean;
  priceCents: Cents;
  stock: number;
  seller: Seller;
  etaDays?: number | null;
  comment?: string;
  imageUrl?: string;
  url?: string;
}

export interface DeckCard {
  id: string;
  name: string;
  set: string;
  setName: string;
  collectorNumber: string;
  scryfallId?: string;
  uniqueCardId?: string;
  moxfieldCardId?: string;
  productId: number | null;
  productUrl?: string;
  quantity: number;
  finish: Finish;
  board: BoardName;
  isBasicLand: boolean;
  isProxy: boolean;
  isAlter: boolean;
  isDigital: boolean;
  language: 'EN';
  typeLine?: string;
  imageUrl?: string;
}

export interface DeckBoard {
  name: BoardName;
  label: string;
  count: number;
  cards: DeckCard[];
}

export interface Deck {
  publicId: string;
  internalId?: string;
  name: string;
  format: string;
  author?: string;
  url: string;
  visibility: string;
  boards: DeckBoard[];
  cards: DeckCard[];
}

export interface CollectionEntry {
  uniqueCardId: string;
  cardId: string;
  quantity: number;
  name?: string;
  set?: string;
  collectorNumber?: string;
  finish?: Finish;
  productId?: number;
}

export interface CollectionIndex {
  entries: CollectionEntry[];
  byUniqueCardId: Map<string, number>;
  byCardId: Map<string, number>;
  bySetCn: Map<string, number>;
  byName: Map<string, number>;
  byProductId: Map<number, number>;
  source: 'moxfield' | 'csv';
  totalOwned: number;
  fetchedAt: string;
}

export interface BoardOption {
  name: BoardName;
  label: string;
  count: number;
  defaultIncluded: boolean;
}

export interface Want {
  id: string;
  name: string;
  quantity: number;
  finish: Finish;
  board: BoardName;
  isBasicLand: boolean;
  exactProductId?: number;
  productUrl?: string;
  metaproductUrl?: string;
  allowAnyPrinting: boolean;
  allowAnyFinish: boolean;
  ownedQuantity: number;
  ownedExactQuantity: number;
  offers: Offer[];
  missingReason?: string;
}

export interface DeckOptions {
  boards: BoardName[];
  includeBasicLands: boolean;
  ignoreOwned: boolean;
  mode: BuyMode;
  minCondition: Condition;
  sellerCountryIds: CountryId[];
  minSellerScore?: number;
  commercialOnly: boolean;
  alwaysTrack: boolean;
  destinationCountryId: CountryId;
}

export interface ShippingMethod {
  methodKey: string;
  name: string;
  isTracked: boolean;
  maxValueCents: Cents;
  maxWeightG: number;
  stampPriceRaw: string;
  stampPriceCents: Cents | null;
  priceCents: Cents;
  isLetter: boolean;
  isVirtual: boolean;
}

export type ShippingTable = ReadonlyMap<string, readonly ShippingMethod[]>;
export type RouteEtaTable = ReadonlyMap<string, number>;

export interface SellerInfo {
  id: string;
  name: string;
  countryId: CountryId;
  minOrderValueCents: Cents;
  requiresTracking: boolean;
  etaDays?: number | null;
}

export interface OptimizerPolicy {
  gramsPerCard: number;
  weightSafetyFactor: number;
  extraPackagingG: number;
  trackingThresholdCents: Cents;
  alwaysTrack: boolean;
  trusteeRateBps: number;
  minTrusteeFeeCents: Cents;
  letterCapacityMode: 'conservative' | 'published' | 'weight';
  allowPartial: boolean;
  maxOffersPerWant: number;
  maxIterations: number;
  defaultEtaDays: number;
}

export interface SelectedMethod {
  methodKey: string;
  name: string;
  priceCents: Cents;
  trusteeFeeCents: Cents;
  comparableTotalCents: Cents;
  maxValueCents: Cents;
  maxWeightG: number;
  isTracked: boolean;
  isLetter: boolean;
}

export interface PlanLine {
  wantId: string;
  name: string;
  quantity: number;
  offerId: string;
  productId?: number;
  expansion?: string;
  condition: Condition;
  finish: Finish;
  priceCents: Cents;
}

export interface PlanOrder {
  seller: Seller;
  lines: PlanLine[];
  itemsCents: Cents;
  cardCount: number;
  shippingCents: Cents;
  trusteeCents: Cents;
  totalCents: Cents;
  etaDays: number | null;
  shippingMethod: {
    name: string;
    isTracked: boolean;
    priceCents: Cents;
  };
}

export interface PlanMissing {
  wantId: string;
  name: string;
  requested: number;
  filled: number;
  shortfall: number;
  reason: string;
}

export interface PlanTotals {
  itemsCents: Cents;
  shippingCents: Cents;
  trusteeCents: Cents;
  totalCents: Cents;
  orderCount: number;
  cardCount: number;
  slowestEtaDays: number | null;
}

export interface Plan {
  id: string;
  variant: PlanVariant;
  orders: PlanOrder[];
  missing: PlanMissing[];
  totals: PlanTotals;
  mode: BuyMode;
  generatedAt: string;
}

export interface CurvePoint {
  maxOrders: number;
  totalCents: Cents | null;
  feasible: boolean;
}

export interface OptimizationResult {
  plans: Plan[];
  maxOrdersCurve: CurvePoint[];
}

export interface Settings {
  destinationCountryId: CountryId;
  boards: BoardName[];
  includeBasicLands: boolean;
  ignoreOwned: boolean;
  mode: BuyMode;
  minCondition: Condition;
  sellerCountryIds: CountryId[];
  minSellerScore?: number;
  commercialOnly: boolean;
  alwaysTrack: boolean;
}

export interface MoxfieldTab {
  tabId: number;
  publicId: string;
  url: string;
  title: string;
}

export interface AppContext {
  activeTab?: { tabId: number; url: string; title: string };
  moxfieldTabs: MoxfieldTab[];
  cardmarketTab?: { tabId: number; url: string; title: string };
  destinationCountryId: CountryId;
}

export interface ApplyItem {
  articleId: string;
  quantity: number;
}

export interface ApplyResult {
  ok: boolean;
  added: number;
  message: string;
}
