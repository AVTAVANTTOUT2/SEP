import { LatLng } from '../types';
import { distanceMeters } from '../geo';

// Routage piéton OpenStreetMap (serveur OSRM de la FOSSGIS, utilisé par openstreetmap.org)
const OSRM_FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
// Altitudes IGN RGE ALTI : terrain « sol nu » au mètre près, en France uniquement (-99999 ailleurs)
const IGN_ELEVATION_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const IGN_NO_DATA = -99999;
// Repli hors de France : Copernicus DEM 90 m, approximatif en ville car il inclut les bâtiments
const OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const MAX_ELEVATION_SAMPLES = 100; // limite des deux services par requête
const BRIDGE_MAX_WIDTH_METERS = 200;
const SAMPLE_SPACING_METERS = 40;
const REQUEST_TIMEOUT_MS = 8000;

// 5 % est la pente maximale des normes d'accessibilité françaises ;
// au-delà de 8 %, la montée devient très difficile en fauteuil.
export const MODERATE_GRADE = 5;
export const STEEP_GRADE = 8;

export type GradeLevel = 'ok' | 'moderate' | 'steep';
export type ElevationSource = 'ign' | 'open-meteo';

export interface ElevationSample {
  distance: number; // mètres depuis le départ
  elevation: number;
}

export interface RouteSegment {
  level: GradeLevel;
  points: LatLng[];
}

export interface RouteAlert {
  kind: 'montée' | 'descente';
  level: GradeLevel;
  grade: number; // en %, valeur absolue
  distanceFromStart: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  ascentMeters: number;
  descentMeters: number;
  maxGrade: number; // en %, valeur absolue
  samples: ElevationSample[];
  grades: number[]; // pente (en %) entre samples[i] et samples[i + 1]
  segments: RouteSegment[]; // tracé découpé par niveau de pente, pour la carte
  alert: RouteAlert | null;
  elevationSource: ElevationSource;
}

export const gradeLevel = (grade: number): GradeLevel => {
  const steepness = Math.abs(grade);
  if (steepness >= STEEP_GRADE) return 'steep';
  if (steepness >= MODERATE_GRADE) return 'moderate';
  return 'ok';
};

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function cumulativeDistances(path: LatLng[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceMeters(path[i - 1], path[i]));
  }
  return cumulative;
}

// Points régulièrement espacés le long du tracé (les distances cibles sont croissantes)
function resample(path: LatLng[], cumulative: number[], targets: number[]): LatLng[] {
  let i = 1;
  return targets.map((target) => {
    while (i < path.length - 1 && cumulative[i] < target) i++;
    const span = cumulative[i] - cumulative[i - 1];
    const t = span > 0 ? Math.min(1, (target - cumulative[i - 1]) / span) : 0;
    return {
      lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
      lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
    };
  });
}

// Moyenne glissante sur 3 points pour lisser les marches du modèle de terrain
const smooth = (values: number[]) =>
  values.map((_, i) => {
    const window = values.slice(Math.max(0, i - 1), i + 2);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });

async function fetchIgnElevations(points: LatLng[]): Promise<number[] | null> {
  const params = new URLSearchParams({
    lon: points.map((p) => p.lng.toFixed(5)).join('|'),
    lat: points.map((p) => p.lat.toFixed(5)).join('|'),
    resource: 'ign_rge_alti_wld',
    zonly: 'true',
    delimiter: '|',
  });
  try {
    const { elevations } = await fetchJson(`${IGN_ELEVATION_URL}?${params}`);
    const valid =
      Array.isArray(elevations) &&
      elevations.length === points.length &&
      elevations.every((elevation: number) => elevation > IGN_NO_DATA);
    return valid ? elevations : null;
  } catch {
    return null;
  }
}

// Un modèle « sol nu » ne voit pas les ponts : le profil plonge au niveau de l'eau puis remonte.
// Une fermeture morphologique (max puis min glissants) comble ces creux étroits sans toucher aux vraies pentes.
function fillBridgeDips(values: number[], halfWindow: number): number[] {
  const around = (list: number[], i: number) => list.slice(Math.max(0, i - halfWindow), i + halfWindow + 1);
  const dilated = values.map((_, i) => Math.max(...around(values, i)));
  return dilated.map((_, i) => Math.min(...around(dilated, i)));
}

async function fetchOpenMeteoElevations(points: LatLng[]): Promise<number[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(5)).join(','),
    longitude: points.map((p) => p.lng.toFixed(5)).join(','),
  });
  const data = await fetchJson(`${OPEN_METEO_ELEVATION_URL}?${params}`);
  if (!Array.isArray(data.elevation) || data.elevation.length !== points.length) {
    throw new Error('Altitudes indisponibles');
  }
  return data.elevation;
}

// Découpe le tracé complet en tronçons de même niveau de pente
function buildSegments(path: LatLng[], cumulative: number[], spacing: number, grades: number[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  path.forEach((point, i) => {
    const interval = Math.min(Math.floor(cumulative[i] / spacing), grades.length - 1);
    const level = gradeLevel(grades[interval] ?? 0);
    const current = segments[segments.length - 1];
    if (current && current.level === level) {
      current.points.push(point);
    } else {
      // Le tronçon précédent se termine sur ce point pour que le tracé reste continu
      current?.points.push(point);
      segments.push({ level, points: [point] });
    }
  });
  return segments.filter((segment) => segment.points.length > 1);
}

function findAlert(samples: ElevationSample[], grades: number[]): RouteAlert | null {
  // On signale d'abord la première pente raide, sinon la première pente marquée
  const steepIndex = grades.findIndex((grade) => gradeLevel(grade) === 'steep');
  const index = steepIndex !== -1 ? steepIndex : grades.findIndex((grade) => gradeLevel(grade) === 'moderate');
  if (index === -1) return null;
  const grade = grades[index];
  return {
    kind: grade > 0 ? 'montée' : 'descente',
    level: gradeLevel(grade),
    grade: Math.round(Math.abs(grade)),
    distanceFromStart: samples[index].distance,
  };
}

export const fetchAccessibleRoute = async (from: LatLng, to: LatLng): Promise<RouteResult> => {
  const data = await fetchJson(
    `${OSRM_FOOT_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
  );
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Aucun trajet trouvé');

  const route = data.routes[0];
  const path: LatLng[] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
  const cumulative = cumulativeDistances(path);
  const total = cumulative[cumulative.length - 1];

  const sampleCount = Math.min(MAX_ELEVATION_SAMPLES, Math.max(2, Math.round(total / SAMPLE_SPACING_METERS) + 1));
  const spacing = total / (sampleCount - 1) || 1;
  const distances = Array.from({ length: sampleCount }, (_, i) => i * spacing);
  const points = resample(path, cumulative, distances);
  const ignElevations = await fetchIgnElevations(points);
  const elevationSource: ElevationSource = ignElevations ? 'ign' : 'open-meteo';
  const elevations = smooth(
    ignElevations
      ? fillBridgeDips(ignElevations, Math.max(1, Math.round(BRIDGE_MAX_WIDTH_METERS / 2 / spacing)))
      : await fetchOpenMeteoElevations(points)
  );

  const samples = distances.map((distance, i) => ({ distance, elevation: elevations[i] }));
  const grades = samples.slice(1).map((sample, i) => ((sample.elevation - samples[i].elevation) / spacing) * 100);

  let ascentMeters = 0;
  let descentMeters = 0;
  samples.slice(1).forEach((sample, i) => {
    const delta = sample.elevation - samples[i].elevation;
    if (delta > 0) ascentMeters += delta;
    else descentMeters -= delta;
  });

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    ascentMeters: Math.round(ascentMeters),
    descentMeters: Math.round(descentMeters),
    maxGrade: Math.round(Math.max(0, ...grades.map(Math.abs))),
    samples,
    grades,
    segments: buildSegments(path, cumulative, spacing, grades),
    alert: findAlert(samples, grades),
    elevationSource,
  };
};
