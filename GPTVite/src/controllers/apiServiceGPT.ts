import { v4 as uuidv4 } from 'uuid';
import { Activity, ActivitySetting, ApiResponse, LatLng, UserInfo, Weather } from '../types';

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ActivityRequest {
  origin: LatLng;
  bounds: MapBounds;
  userInfo: UserInfo;
  weather: Weather | null;
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'https://www.unsimplesourire.com/thibault/GoodMaps/api'
).replace(/\/$/, '');

const SETTINGS: ActivitySetting[] = ['interieur', 'exterieur', 'mixte'];

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

// L'IA peut renvoyer n'importe quoi : on n'accepte que des liens http(s)
const safeUrl = (value: unknown) => {
  const url = text(value);
  return url && /^https?:\/\//i.test(url) ? url : undefined;
};

const normalizeActivity = (raw: Record<string, unknown>): Activity | null => {
  const name = text(raw.name);
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const duration = Number(raw.duration_minutes);
  return {
    id: uuidv4(),
    name,
    description: text(raw.description) ?? '',
    lat,
    lng,
    opening_hours: text(raw.opening_hours),
    booking_link: safeUrl(raw.booking_link),
    phone_number: text(raw.phone_number),
    emoji: text(raw.emoji)?.slice(0, 8),
    setting: SETTINGS.find((setting) => setting === raw.setting),
    duration_minutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
    intensity: text(raw.intensity),
    seating: typeof raw.seating === 'boolean' ? raw.seating : undefined,
    why: text(raw.why),
  };
};

const buildRequestBody = ({ origin, bounds, userInfo, weather }: ActivityRequest) =>
  JSON.stringify({
    latitude: origin.lat,
    longitude: origin.lng,
    north: bounds.north,
    south: bounds.south,
    east: bounds.east,
    west: bounds.west,
    userInfo,
    weather: weather && {
      temperature: weather.temperature,
      apparentTemperature: weather.apparentTemperature,
      condition: weather.condition,
    },
  });

// Ancien endpoint : renvoie les 5 activités d'un coup
export const fetchActivities = async (request: ActivityRequest, signal?: AbortSignal): Promise<Activity[]> => {
  const response = await fetch(`${API_BASE_URL}/getActivities.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildRequestBody(request),
    signal,
  });

  if (!response.ok) {
    throw new Error("Erreur lors de la récupération des données de l'API");
  }

  const data: ApiResponse = await response.json();
  return (data.activities ?? [])
    .map((activity) => normalizeActivity(activity as unknown as Record<string, unknown>))
    .filter((activity): activity is Activity => activity !== null);
};

// Nouvel endpoint : l'IA écrit une activité par ligne (NDJSON) et chacune est transmise dès qu'elle est complète.
// Si l'endpoint n'est pas encore déployé, on se replie sur l'ancien.
export const streamActivities = async (
  request: ActivityRequest,
  onActivity: (activity: Activity) => void,
  signal?: AbortSignal
): Promise<number> => {
  let response: Response | null = null;
  try {
    response = await fetch(`${API_BASE_URL}/getActivitiesStream.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildRequestBody(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  // Endpoint absent du serveur (pas encore déployé) : la requête CORS échoue ou renvoie 404
  if (!response || response.status === 404 || !response.body) {
    console.warn('Streaming indisponible, repli sur getActivities.php');
    const activities = await fetchActivities(request, signal);
    activities.forEach(onActivity);
    return activities.length;
  }

  if (!response.ok) {
    const body = await response.text();
    let message = `Erreur HTTP ${response.status}`;
    try {
      message = JSON.parse(body.split('\n')[0]).error ?? message;
    } catch {
      /* corps non JSON : on garde le code HTTP */
    }
    throw new Error(message);
  }

  let count = 0;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.error) throw new Error(String(parsed.error));
    const activity = normalizeActivity(parsed);
    if (activity) {
      count++;
      onActivity(activity);
    }
  };

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  handleLine(buffer);

  return count;
};
