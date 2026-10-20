// src/types.ts
export interface LatLng {
  lat: number;
  lng: number;
}

export type ActivitySetting = 'interieur' | 'exterieur' | 'mixte';

export interface Activity {
  id: string;
  name: string;
  description: string;
  lat: number; // Utilisation de 'lat' au lieu de 'latitude'
  lng: number; // Utilisation de 'lng' au lieu de 'longitude'
  opening_hours?: string;
  booking_link?: string;
  phone_number?: string;
  emoji?: string;
  setting?: ActivitySetting;
  duration_minutes?: number;
  intensity?: string;
  seating?: boolean; // bancs ou places assises sur place
  why?: string; // pourquoi l'activité est adaptée à l'énergie et à la météo du jour
  photo?: PlacePhoto;
  distanceMeters?: number; // à vol d'oiseau depuis le point de départ de la recherche
}

export interface PlacePhoto {
  url: string;
  pageUrl: string;
  title: string;
}

export interface ApiResponse {
  activities: Activity[];
}

export interface UserInfo {
  ability: string;
  activityPreferences: string;
  energy: number; // nombre de cuillères, de 1 à 5
}

export type WeatherCondition = 'chaleur' | 'pluie' | 'normal';

export interface Weather {
  temperature: number;
  apparentTemperature: number;
  condition: WeatherCondition;
  emoji: string;
}
