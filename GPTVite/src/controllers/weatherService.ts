import { LatLng, Weather, WeatherCondition } from '../types';

// Open-Meteo : gratuit, sans clé, CORS ouvert
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// La chaleur aggrave les symptômes de la SEP (phénomène d'Uhthoff)
export const HEAT_THRESHOLD_CELSIUS = 25;

// Codes météo WMO : bruine, pluie, neige, averses, orages
const isWetWeatherCode = (code: number) =>
  (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 86) || code >= 95;

function weatherEmoji(code: number, condition: WeatherCondition): string {
  if (condition === 'chaleur') return '🥵';
  if (code >= 95) return '⛈️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️';
  if (condition === 'pluie') return '🌧️';
  if (code === 45 || code === 48) return '🌫️';
  if (code === 0) return '☀️';
  return '⛅';
}

export const fetchWeather = async (position: LatLng): Promise<Weather | null> => {
  const params = new URLSearchParams({
    latitude: position.lat.toFixed(4),
    longitude: position.lng.toFixed(4),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code',
    timezone: 'auto',
  });

  try {
    const response = await fetch(`${OPEN_METEO_URL}?${params}`);
    if (!response.ok) throw new Error(`Open-Meteo : HTTP ${response.status}`);
    const { current } = await response.json();

    const temperature = Math.round(current.temperature_2m);
    const apparentTemperature = Math.round(current.apparent_temperature);
    const code: number = current.weather_code;

    let condition: WeatherCondition = 'normal';
    if (current.precipitation > 0.1 || isWetWeatherCode(code)) {
      condition = 'pluie';
    } else if (Math.max(temperature, apparentTemperature) >= HEAT_THRESHOLD_CELSIUS) {
      condition = 'chaleur';
    }

    return { temperature, apparentTemperature, condition, emoji: weatherEmoji(code, condition) };
  } catch (error) {
    console.error('Erreur météo : ', error);
    return null;
  }
};
