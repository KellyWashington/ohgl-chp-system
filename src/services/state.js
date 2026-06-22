export let DB = { facilities: [], activeFacId: null };
export let currentUser = null;
export let currentProfile = null;
export let editingCHPIdx = -1;
export let selectedPriority = '';

export function setDB(val) {
  DB = val;
}

export function setCurrentUser(val) {
  currentUser = val;
}

export function setCurrentProfile(val) {
  currentProfile = val;
}

export function setEditingCHPIdx(val) {
  editingCHPIdx = val;
}

export function setSelectedPriority(val) {
  selectedPriority = val;
}

export function fac() {
  return DB.facilities.find(f => f.id === DB.activeFacId) || DB.facilities[0] || null;
}
