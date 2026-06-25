export const ROLE_PERMS = {
  super_admin: ['*'],
  facility_admin: [
    'facility:manage',
    'facility:read',
    'patient:read',
    'patient:write',
    'referral:*',
    'chp:*',
    'report:read',
    'group:read',
    'audit:read',
  ],
  facility_officer: [
    'facility:read',
    'patient:read',
    'referral:create',
    'referral:read',
    'referral:update',
    'report:read',
  ],
  chp: ['facility:read', 'referral:create', 'referral:read_own'],
};

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  facility_admin: 'Facility Administrator',
  facility_officer: 'Facility Officer',
  chp: 'CHP',
};

export const DEFAULT_FACS = [
  { name: 'Oasis Specialist Hospital', location: 'Kisii', level: 'Level 5', email: 'kisii@oasishealthcaregroup.com', phone: '+254 700 000 001' },
  { name: 'Oasis Doctors Siaya', location: 'Siaya', level: 'Level 4', email: 'siaya@oasishealthcaregroup.com', phone: '+254 748 450 548' },
  { name: 'Oasis Medical Centre', location: 'Nairobi', level: 'Level 4', email: 'nairobi@oasishealthcaregroup.com', phone: '+254 700 000 003' },
  { name: 'Oasis Medical Centre', location: 'Kitui', level: 'Level 3', email: 'kitui@oasishealthcaregroup.com', phone: '+254 700 000 004' },
  { name: 'Oasis Doctors Kehancha', location: 'Kehancha', level: 'Level 3', email: 'kehancha@oasishealthcaregroup.com', phone: '+254 700 000 005' },
  { name: 'Oasis Doctors Migori', location: 'Migori', level: 'Level 4', email: 'migori@oasishealthcaregroup.com', phone: '+254 700 000 006' },
  { name: 'Oasis Doctors Homa Bay', location: 'Homa Bay', level: 'Level 4', email: 'homabay@oasishealthcaregroup.com', phone: '+254 700 000 007' },
];

export const CATS = [
  { label: 'Maternal Care', match: ['Maternal Care'] },
  { label: 'General OPD', match: ['General OPD', 'Outpatient/OPD'] },
  { label: 'NCD Screening', match: ['NCD Screening'] },
  { label: 'Mental Health', match: ['Mental Health'] },
  { label: 'Child Health', match: ['Child Health'] },
  { label: 'Emergency/Other', match: ['Emergency', 'Other', 'Emergency/Other'] },
];

export const CAT_COLORS = ['#6B3FA0', '#00A896', '#1E40AF', '#BE185D', '#D97706', '#C62828'];
export const CAT_ICONS = ['<i class="ti ti-heart"></i>', '+', '<i class="ti ti-stethoscope"></i>', '~', '<i class="ti ti-baby-carriage"></i>', '!'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
