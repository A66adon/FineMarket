export interface Country {
  id: number;
  name: string;
}

export const COUNTRIES: readonly Country[] = [
  { id: 1, name: 'Austria' },
  { id: 2, name: 'Belgium' },
  { id: 3, name: 'Bulgaria' },
  { id: 35, name: 'Croatia' },
  { id: 5, name: 'Cyprus' },
  { id: 6, name: 'Czech Republic' },
  { id: 8, name: 'Denmark' },
  { id: 9, name: 'Estonia' },
  { id: 11, name: 'Finland' },
  { id: 12, name: 'France' },
  { id: 7, name: 'Germany' },
  { id: 14, name: 'Greece' },
  { id: 15, name: 'Hungary' },
  { id: 37, name: 'Iceland' },
  { id: 16, name: 'Ireland' },
  { id: 17, name: 'Italy' },
  { id: 36, name: 'Japan' },
  { id: 21, name: 'Latvia' },
  { id: 18, name: 'Liechtenstein' },
  { id: 19, name: 'Lithuania' },
  { id: 20, name: 'Luxembourg' },
  { id: 22, name: 'Malta' },
  { id: 23, name: 'Netherlands' },
  { id: 24, name: 'Norway' },
  { id: 25, name: 'Poland' },
  { id: 26, name: 'Portugal' },
  { id: 27, name: 'Romania' },
  { id: 29, name: 'Singapore' },
  { id: 31, name: 'Slovakia' },
  { id: 30, name: 'Slovenia' },
  { id: 10, name: 'Spain' },
  { id: 28, name: 'Sweden' },
  { id: 4, name: 'Switzerland' },
  { id: 13, name: 'United Kingdom' },
];

export const COUNTRY_BY_ID = new Map(COUNTRIES.map((country) => [country.id, country]));
export const DEFAULT_BUYER_COUNTRY_ID = 7; // Germany

export function countryName(id: number): string {
  return COUNTRY_BY_ID.get(id)?.name ?? 'Unknown';
}

export function countryIdFromName(name: string): number | undefined {
  const normalized = name.trim().toLowerCase();
  return COUNTRIES.find((country) => country.name.toLowerCase() === normalized)?.id;
}
