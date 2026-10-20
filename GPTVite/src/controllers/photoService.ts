import { LatLng, PlacePhoto } from '../types';
import { distanceMeters } from '../geo';

const WIKIPEDIA_API_URL = 'https://fr.wikipedia.org/w/api.php';
const LOOKUP_TIMEOUT_MS = 3000;
// Au-delà, on considère que l'article Wikipédia ne parle pas du même lieu
const MAX_MATCH_DISTANCE_METERS = 3000;

interface WikipediaPage {
  title: string;
  index: number;
  thumbnail?: { source: string };
  coordinates?: { lat: number; lon: number }[];
}

export interface PlaceMatch {
  photo: PlacePhoto;
  location: LatLng; // coordonnées de l'article, plus fiables que celles inventées par l'IA
}

// Cherche l'article Wikipédia du lieu pour en afficher la photo dans le repère.
// Renvoie null si aucun article géolocalisé proche n'est trouvé (le repère garde alors son emoji).
export const findPlacePhoto = async (name: string, near: LatLng): Promise<PlaceMatch | null> => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: name,
    gsrlimit: '3',
    prop: 'pageimages|coordinates',
    piprop: 'thumbnail',
    pithumbsize: '640',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(`${WIKIPEDIA_API_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    const pages: WikipediaPage[] = data.query?.pages ?? [];

    for (const page of [...pages].sort((a, b) => a.index - b.index)) {
      const coords = page.coordinates?.[0];
      // Logos, cartes et schémas (souvent en SVG) sont illisibles dans une bulle ronde : on garde alors l'emoji
      if (!page.thumbnail || !coords || /logo|openstreetmap|\.svg/i.test(page.thumbnail.source)) continue;
      const location = { lat: coords.lat, lng: coords.lon };
      if (distanceMeters(location, near) > MAX_MATCH_DISTANCE_METERS) continue;
      return {
        photo: {
          url: page.thumbnail.source,
          pageUrl: `https://fr.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
          title: page.title,
        },
        location,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
