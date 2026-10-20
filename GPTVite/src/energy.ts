// Jauge « énergie du jour » (théorie des cuillères).
// Les distances doivent rester alignées avec energy_profile() dans api/activitiesCommon.php.

export interface EnergyProfile {
  level: number;
  label: string;
  hint: string;
  maxDistanceMeters: number;
}

export const ENERGY_PROFILES: EnergyProfile[] = [
  { level: 1, label: 'Très peu d’énergie', hint: 'Activité courte et assise, à moins de 500 m.', maxDistanceMeters: 500 },
  { level: 2, label: 'Un peu d’énergie', hint: 'Activité douce, pauses fréquentes, à moins de 1 km.', maxDistanceMeters: 1000 },
  { level: 3, label: 'Énergie moyenne', hint: 'Activité modérée jusqu’à 1 h 30, à moins de 2 km.', maxDistanceMeters: 2000 },
  { level: 4, label: 'Bonne énergie', hint: 'Activité soutenue jusqu’à 2 h, à moins de 5 km.', maxDistanceMeters: 5000 },
  { level: 5, label: 'En pleine forme', hint: 'Grande sortie possible, jusqu’à 10 km.', maxDistanceMeters: 10000 },
];

export const DEFAULT_ENERGY = 3;

export function getEnergyProfile(level: number | undefined): EnergyProfile {
  return ENERGY_PROFILES.find((profile) => profile.level === level) ?? ENERGY_PROFILES[DEFAULT_ENERGY - 1];
}

// Le rayon d'énergie est à vol d'oiseau alors que les trajets suivent les rues : on tolère un léger dépassement
const REACH_TOLERANCE = 1.15;

export function isBeyondReach(meters: number, profile: EnergyProfile): boolean {
  return meters > profile.maxDistanceMeters * REACH_TOLERANCE;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',').replace(',0', '')} km`;
}
