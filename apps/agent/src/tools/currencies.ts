/** ISO 3166-1 alpha-2 country code → ISO 4217 currency code and symbol. Static: covers the usual travel destinations. */
const EUR = ['EUR', '€'] as const;

const TABLE: Record<string, readonly [string, string | null]> = {
  US: ['USD', '$'], EC: ['USD', '$'], SV: ['USD', '$'], PA: ['USD', '$'], PR: ['USD', '$'],
  AT: EUR, BE: EUR, HR: EUR, CY: EUR, EE: EUR, FI: EUR, FR: EUR, DE: EUR, GR: EUR, IE: EUR, IT: EUR,
  LV: EUR, LT: EUR, LU: EUR, MT: EUR, NL: EUR, PT: EUR, SK: EUR, SI: EUR, ES: EUR, MC: EUR, ME: EUR,
  GB: ['GBP', '£'], CH: ['CHF', 'CHF'], NO: ['NOK', 'kr'], SE: ['SEK', 'kr'], DK: ['DKK', 'kr'], IS: ['ISK', 'kr'],
  PL: ['PLN', 'zł'], CZ: ['CZK', 'Kč'], HU: ['HUF', 'Ft'], RO: ['RON', 'lei'], BG: ['BGN', 'лв'], RS: ['RSD', 'din'],
  AL: ['ALL', 'L'], BA: ['BAM', 'KM'], MK: ['MKD', 'ден'], GE: ['GEL', '₾'], AM: ['AMD', '֏'], AZ: ['AZN', '₼'],
  TR: ['TRY', '₺'], RU: ['RUB', '₽'], UA: ['UAH', '₴'], BY: ['BYN', 'Br'], MD: ['MDL', 'L'],
  UZ: ['UZS', "so'm"], KZ: ['KZT', '₸'], KG: ['KGS', 'с'], TJ: ['TJS', 'SM'], TM: ['TMT', 'm'], MN: ['MNT', '₮'],
  JP: ['JPY', '¥'], CN: ['CNY', '¥'], KR: ['KRW', '₩'], TW: ['TWD', 'NT$'], HK: ['HKD', 'HK$'], SG: ['SGD', 'S$'],
  TH: ['THB', '฿'], VN: ['VND', '₫'], ID: ['IDR', 'Rp'], MY: ['MYR', 'RM'], PH: ['PHP', '₱'], KH: ['KHR', '៛'],
  IN: ['INR', '₹'], LK: ['LKR', 'Rs'], NP: ['NPR', 'Rs'], PK: ['PKR', 'Rs'], BD: ['BDT', '৳'], MV: ['MVR', 'Rf'],
  AE: ['AED', 'د.إ'], SA: ['SAR', '﷼'], QA: ['QAR', '﷼'], OM: ['OMR', '﷼'], KW: ['KWD', 'KD'], BH: ['BHD', 'BD'],
  IL: ['ILS', '₪'], JO: ['JOD', 'JD'], EG: ['EGP', 'E£'], MA: ['MAD', 'MAD'], TN: ['TND', 'DT'], ZA: ['ZAR', 'R'],
  KE: ['KES', 'KSh'], TZ: ['TZS', 'TSh'], NG: ['NGN', '₦'], ET: ['ETB', 'Br'], GH: ['GHS', '₵'],
  CA: ['CAD', 'CA$'], MX: ['MXN', 'MX$'], BR: ['BRL', 'R$'], AR: ['ARS', 'AR$'], CL: ['CLP', 'CL$'], CO: ['COP', 'CO$'],
  PE: ['PEN', 'S/'], UY: ['UYU', '$U'], CR: ['CRC', '₡'], DO: ['DOP', 'RD$'], CU: ['CUP', '$'], JM: ['JMD', 'J$'],
  AU: ['AUD', 'A$'], NZ: ['NZD', 'NZ$'], FJ: ['FJD', 'FJ$'],
};

/** `null` for an unknown country. */
export function currencyFor(countryCode: string): { code: string; symbol: string | null } | null {
  const entry = TABLE[countryCode.toUpperCase()];
  return entry ? { code: entry[0], symbol: entry[1] } : null;
}
