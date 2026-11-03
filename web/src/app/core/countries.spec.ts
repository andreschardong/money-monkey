import { COUNTRIES, COUNTRY_CODES, countryName } from './countries';

describe('countryName', () => {
  it('names a country in Canadian English', () => {
    expect(countryName('CA')).toBe('Canada');
    expect(countryName('GB')).toBe('United Kingdom');
  });

  it.each([null, undefined, ''])('is empty for %j', (input) => {
    expect(countryName(input)).toBe('');
  });

  it('gives the code back when the browser has no name for it', () => {
    vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(undefined);
    expect(countryName('CA')).toBe('CA');
  });

  it('gives the code back when it is not a valid region code', () => {
    expect(countryName('not a code')).toBe('not a code');
  });
});

describe('COUNTRIES', () => {
  it('has one entry per code, each with a name', () => {
    expect(COUNTRIES).toHaveLength(COUNTRY_CODES.length);
    expect(COUNTRIES.every((country) => country.name.length > 0)).toBe(true);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  it('is sorted by name, not by code', () => {
    const names = COUNTRIES.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-CA')));
    expect(COUNTRIES.find((country) => country.code === 'CA')).toEqual({ code: 'CA', name: 'Canada' });
  });
});
