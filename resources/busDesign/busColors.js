export const BUS_COLORS = {
  '107': { busColor: '#187ec2', textColor: '#fff' },
  '1M': { busColor: '#000000', textColor: '#fff' },
  '2M': { busColor: '#000000', textColor: '#fff' },
  '3M': { busColor: '#000000', textColor: '#fff' },
  '4M': { busColor: '#000000', textColor: '#fff' },
  '5M': { busColor: '#000000', textColor: '#fff' },
  '6M': { busColor: '#000000', textColor: '#fff' },
  '7M': { busColor: '#000000', textColor: '#fff' },
  '8M': { busColor: '#000000', textColor: '#fff' },
  '9M': { busColor: '#000000', textColor: '#fff' },
  '10M': { busColor: '#000000', textColor: '#fff' },
  '11M': { busColor: '#000000', textColor: '#fff' },
  '12M': { busColor: '#000000', textColor: '#fff' },
  '13M': { busColor: '#000000', textColor: '#fff' },
  '2': { busColor: '#187ec2', textColor: '#fff' },
  '3': { busColor: '#187ec2', textColor: '#fff' },
  '4': { busColor: '#187ec2', textColor: '#fff' },
  '5': { busColor: '#fcd116', textColor: '#000' },
  '6': { busColor: '#00ac00', textColor: '#000' },
  '7': { busColor: '#FF0000', textColor: '#fff' },
  '8': { busColor: '#a347ff', textColor: '#fff' },
  '9': { busColor: '#FF7900', textColor: '#fff' }
};

export const BUS_ICON_COLORS = {
  stroke: '#18d8d0',
  outline: '#fff'
};

export const CUSTOM_LINE_TEXTS = {
  '107': 'ZC'
};

/**
 * Devolve { busColor, textColor } para uma linha UNIR de 4 dígitos.
 * Regras:
 *  1XXX / 2XXX → #de5b35
 *  3XXX        → #9eb0db
 *  5XXX / 60XX-65XX → #06d6a0
 *  66XX-69XX / 7XXX / 8XXX → #fbb03a
 *  9XXX        → #a4bf62
 */
export function getUnirLineColor(lineStr) {
  const n = parseInt(lineStr, 10);
  if (isNaN(n)) return null;

  if (n >= 1000 && n <= 2999) return { busColor: '#de5b35', textColor: '#fff' };
  if (n >= 3000 && n <= 3999) return { busColor: '#9eb0db', textColor: '#fff' };
  if (
      (n >= 5000 && n <= 5999) ||
      (n >= 6000 && n <= 6599)
  ) return { busColor: '#06d6a0', textColor: '#fff' };
  if (
      (n >= 6600 && n <= 6999) ||
      (n >= 7000 && n <= 8999)
  ) return { busColor: '#fbb03a', textColor: '#fff' };
  if (n >= 9000 && n <= 9999) return { busColor: '#a4bf62', textColor: '#fff' };

  return null;
}