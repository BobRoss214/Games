// Random identifiers generator: a name that belongs to nobody in particular, with a postal address
// that has a real city, region, and postal code, but an invented street.
//
// Everything happens in this module. It asks no server and it reads no browser page.
// It also runs in Node.js, where the tests use it.
//
// To add a country:
// 1. Add it to COUNTRIES.
// 2. Add a data file like us.js that exports generate(randomInt), and name it in LOADERS.
// 3. Add its address layout to LAYOUTS and its field patterns to SHAPES.

export const COUNTRIES = [{ code: 'US', label: 'United States' }];

// The data of a country is loaded on first use. A country that nobody picks costs nothing.
const LOADERS = {
  US: () => import('./us.js'),
};

// How the address lines of a country are written.
const LAYOUTS = {
  US: (p) => [p.street, p.unit, `${p.city}, ${p.region} ${p.postalCode}`, 'United States'],
};

// Patterns for the fields that have a fixed form in a country.
const SHAPES = {
  US: { region: /^[A-Z]{2}$/, postalCode: /^[0-9]{5}$/ },
};

// The fields of a result with the smallest and the largest length of each text.
const FIELDS = {
  firstName: [1, 40],
  lastName: [1, 40],
  street: [1, 80],
  unit: [0, 20],
  city: [1, 60],
  region: [1, 10],
  regionName: [1, 60],
  postalCode: [1, 12],
};
const KEYS = ['v', 'country', ...Object.keys(FIELDS)];
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// A whole number from 0 to n - 1. Every number has the same chance.
// The numbers come from the secure generator of the platform. A draw that would make
// some results more likely than others is thrown away and made again.
export function randomInt(n) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) {
    throw new RangeError('randomInt needs a whole number from 1 to 4294967296.');
  }
  const limit = Math.floor(0x100000000 / n) * n; // the largest multiple of n that fits in 32 bits
  const draw = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(draw);
    if (draw[0] < limit) return draw[0] % n;
  }
}

// Makes new details for a country. Call it again to get different details.
export async function generatePersona(countryCode = 'US') {
  if (typeof countryCode !== 'string' || !own(LOADERS, countryCode)) {
    throw new Error('This country is not available.');
  }
  const data = await LOADERS[countryCode]();
  const made = data.generate(randomInt);
  return {
    v: 1,
    country: countryCode,
    firstName: made.firstName,
    lastName: made.lastName,
    street: made.street,
    unit: made.unit,
    city: made.city,
    region: made.region,
    regionName: made.regionName,
    postalCode: made.postalCode,
  };
}

// True if the value has exactly the form of a result of generatePersona().
// Use it on data that comes from storage, before the data is shown.
export function isPersona(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || !KEYS.every((key) => own(value, key))) return false;
  if (value.v !== 1) return false;
  if (typeof value.country !== 'string' || !own(LAYOUTS, value.country)) return false;
  for (const [field, [min, max]] of Object.entries(FIELDS)) {
    const text = value[field];
    if (typeof text !== 'string' || text.length < min || text.length > max) return false;
    if (CONTROL_CHARACTER.test(text) || text !== text.trim()) return false;
  }
  const shape = SHAPES[value.country];
  return Object.entries(shape).every(([field, pattern]) => pattern.test(value[field]));
}

export function fullName(p) {
  return `${p.firstName} ${p.lastName}`;
}

// The address as lines, in the usual layout of the country. A line for the unit is there only if there is a unit.
export function addressLines(p) {
  const layout = own(LAYOUTS, p.country) ? LAYOUTS[p.country] : LAYOUTS.US;
  return layout(p).filter((line) => line !== '');
}

// The address in one line, for a copy button. The name is not in it: use fullName() for the name.
export function singleLine(p) {
  return addressLines(p).join(', ');
}
