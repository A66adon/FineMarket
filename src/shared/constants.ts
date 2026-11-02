import type {
  BoardName,
  Condition,
  Finish,
  OptimizerPolicy,
  Settings,
} from './types';
import { DEFAULT_BUYER_COUNTRY_ID } from './countries';

export const CARDMARKET_BASE = 'https://www.cardmarket.com';
export const CARDMARKET_SHIPPING_API = 'https://help.cardmarket.com/api/shippingCosts';
export const MOXFIELD_API = 'https://api2.moxfield.com/v3/decks/all';

export const BOARD_LABELS: Record<BoardName, string> = {
  mainboard: 'Mainboard',
  commanders: 'Commanders',
  companions: 'Companions',
  sideboard: 'Sideboard',
  maybeboard: 'Maybeboard',
  tokens: 'Tokens',
  signatureSpells: 'Signature spells',
  attractions: 'Attractions',
  stickers: 'Stickers',
  contraptions: 'Contraptions',
  planes: 'Planes',
  schemes: 'Schemes',
};

export const BOARD_ORDER: BoardName[] = [
  'mainboard',
  'commanders',
  'companions',
  'sideboard',
  'maybeboard',
  'signatureSpells',
  'tokens',
  'attractions',
  'stickers',
  'contraptions',
  'planes',
  'schemes',
];

export const BOARD_DEFAULT_INCLUDED: Record<BoardName, boolean> = {
  mainboard: true,
  commanders: true,
  companions: true,
  sideboard: false,
  maybeboard: false,
  tokens: false,
  signatureSpells: false,
  attractions: false,
  stickers: false,
  contraptions: false,
  planes: false,
  schemes: false,
};

export const CONDITION_RANK: Record<Condition, number> = {
  MT: 1,
  NM: 2,
  EX: 3,
  GD: 4,
  LP: 5,
  PL: 6,
  PO: 7,
};

export const CONDITION_LABELS: Record<Condition, string> = {
  MT: 'Mint',
  NM: 'Near Mint',
  EX: 'Excellent',
  GD: 'Good',
  LP: 'Light Played',
  PL: 'Played',
  PO: 'Poor',
};

export const CONDITION_TO_CARDMARKET_ID: Record<Condition, number> = {
  MT: 1,
  NM: 2,
  EX: 3,
  GD: 4,
  LP: 5,
  PL: 6,
  PO: 7,
};

export const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched',
};

export const DEFAULT_SETTINGS: Settings = {
  destinationCountryId: DEFAULT_BUYER_COUNTRY_ID,
  boards: ['mainboard', 'commanders', 'companions'],
  includeBasicLands: true,
  ignoreOwned: false,
  mode: 'cheapest-playable',
  minCondition: 'EX',
  sellerCountryIds: [],
  commercialOnly: false,
  alwaysTrack: false,
};

export const DEFAULT_POLICY: OptimizerPolicy = {
  gramsPerCard: 2.5,
  weightSafetyFactor: 1,
  extraPackagingG: 0,
  trackingThresholdCents: 2500,
  alwaysTrack: false,
  trusteeRateBps: 100,
  minTrusteeFeeCents: 1,
  letterCapacityMode: 'conservative',
  allowPartial: true,
  maxOffersPerWant: 30,
  maxIterations: 80,
  defaultEtaDays: 14,
};

export const CARDMARKET_CART_ADD_ACTION =
  'ShoppingCart_Add_AddArticlesFromProductPage';

export const OFFERS_PER_CARDMARKET_PAGE = 50;

export const UNOFFICIAL_DISCLAIMER =
  'Unofficial tool. Not affiliated with Cardmarket or Moxfield. Use at your own risk.';
