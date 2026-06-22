export function makeFac(d) {
  return {
    id: d.id || crypto.randomUUID(),
    name: d.name,
    location: d.location,
    level: d.level || 'Level 4',
    email: d.email || '',
    phone: d.phone || '',
    subcounty: d.subcounty || '',
    token: d.token_rate || d.token || 200,
    year: d.financial_year || d.year || 2026,
    compiler: d.compiler || '',
    coic: d.coic || '',
    chps: [],
    referrals: [],
  };
}
