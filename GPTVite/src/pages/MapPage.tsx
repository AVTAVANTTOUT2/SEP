import '../App.css';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import GoogleMapComponent, { MapHandle } from '../components/GoogleMapComponent';
import { MapBounds, streamActivities } from '../controllers/apiServiceGPT';
import { fetchWeather } from '../controllers/weatherService';
import { findPlacePhoto } from '../controllers/photoService';
import { fetchAccessibleRoute, RouteResult } from '../controllers/routeService';
import { Activity, LatLng, UserInfo, Weather } from '../types';
import { formatDistance, getEnergyProfile, isBeyondReach } from '../energy';
import { distanceMeters, sleep } from '../geo';
// import resaIcon from '../assets/book.webp';
import AddCircleIcon from '../assets/add_circle.svg';
// import telIcon from '../assets/tel.png';
import PlayCircleIcon from '../assets/play_circle.svg';
import WeatherBanner from '../components/WeatherBanner';
import RoutePanel from '../components/RoutePanel';
import logo from '../assets/logo-goodmaps.png';

const PARIS: LatLng = { lat: 48.8566, lng: 2.3522 };
// Temps passé sur chaque lieu quand la caméra le survole
const REVEAL_PAUSE_MS = 1100;

const SETTING_LABELS = {
  interieur: '🏠 Intérieur',
  exterieur: '🌳 Extérieur',
  mixte: '🏠🌳 Intérieur et extérieur',
};

type RouteState =
  | { activityId: string; status: 'loading' }
  | { activityId: string; status: 'ready'; result: RouteResult }
  | { activityId: string; status: 'error' };

// Photo Wikipédia (et coordonnées plus fiables) + distance depuis le point de départ
async function enrichActivity(activity: Activity, origin: LatLng): Promise<Activity> {
  const match = await findPlacePhoto(activity.name, activity);
  const position = match?.location ?? { lat: activity.lat, lng: activity.lng };
  return { ...activity, ...position, photo: match?.photo, distanceMeters: distanceMeters(origin, position) };
}

const MapPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const userInfo = location.state as UserInfo | undefined;
  const energy = getEnergyProfile(userInfo?.energy);

  // Si `userInfo` est `undefined`, rediriger vers la page d'accueil
  useEffect(() => {
    if (!userInfo) {
      navigate('/');
    }
  }, [userInfo, navigate]);

  const mapRef = useRef<MapHandle>(null);
  const activityInfoRef = useRef<HTMLDivElement | null>(null);
  const searchIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [revealing, setRevealing] = useState<Activity | null>(null); // lieu survolé pendant le streaming
  const [searchOrigin, setSearchOrigin] = useState<LatLng | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [bounds, setBounds] = useState<MapBounds>({
    north: 48.9021449,
    south: 48.815573,
    east: 2.4699208,
    west: 2.224199
  });

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => {
        /* le centre de la carte servira de point de départ */
      }
    );
  }, []);

  useEffect(() => {
    if (userLocation) fetchWeather(userLocation).then(setWeather);
  }, [userLocation]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectActivity = (activity: Activity | null) => {
    setSelectedActivity(activity);
    setRouteState(null);
  };

  const handleGetSuggestions = useCallback(async () => {
    if (!userInfo) return;
    const searchId = ++searchIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const origin = userLocation ?? mapRef.current?.getCenter() ?? PARIS;
    setIsSearching(true);
    setError(null);
    setActivities([]);
    setSelectedActivity(null);
    setRouteState(null);
    setSearchOrigin(origin);

    const currentWeather = weather ?? (await fetchWeather(origin));
    if (searchId !== searchIdRef.current) return;
    setWeather(currentWeather);

    // Chaque activité est enrichie dès son arrivée, puis révélée une par une : le repère tombe et la caméra le survole
    const revealed: Activity[] = [];
    let revealQueue: Promise<void> = Promise.resolve();
    const reveal = (activity: Activity) => {
      const enriched = enrichActivity(activity, origin);
      revealQueue = revealQueue.then(async () => {
        const ready = await enriched;
        if (searchId !== searchIdRef.current) return;
        revealed.push(ready);
        setActivities((previous) => [...previous, ready]);
        setRevealing(ready);
        if (revealed.length === 1) setSelectedActivity(ready);
        mapRef.current?.flyTo(ready, 16);
        await sleep(REVEAL_PAUSE_MS);
      });
    };

    try {
      await streamActivities({ origin, bounds, userInfo, weather: currentWeather }, reveal, controller.signal);
      await revealQueue;
      if (searchId !== searchIdRef.current) return;
      if (revealed.length === 0) {
        setError('Aucune activité trouvée pour le moment. Réessayez dans un instant.');
      } else {
        mapRef.current?.fitPoints([origin, ...revealed]);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Erreur API : ', err);
      await revealQueue;
      if (searchId !== searchIdRef.current) return;
      setError(
        revealed.length
          ? 'La recherche s’est interrompue avant la fin. Voici les premières idées trouvées.'
          : 'Impossible de récupérer des suggestions pour le moment. Réessayez dans un instant.'
      );
    } finally {
      if (searchId === searchIdRef.current) {
        setIsSearching(false);
        setRevealing(null);
      }
    }
  }, [bounds, userInfo, userLocation, weather]);

  const handleMarkerClick = (activity: Activity) => {
    selectActivity(activity);
    activityInfoRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleShowRoute = async () => {
    const from = userLocation ?? searchOrigin;
    if (!selectedActivity || !from) return;
    const activityId = selectedActivity.id;
    setRouteState({ activityId, status: 'loading' });
    try {
      const result = await fetchAccessibleRoute(from, selectedActivity);
      setRouteState((current) => (current?.activityId === activityId ? { activityId, status: 'ready', result } : current));
    } catch (err) {
      console.error('Erreur itinéraire : ', err);
      setRouteState((current) => (current?.activityId === activityId ? { activityId, status: 'error' } : current));
    }
  };

  const route = routeState && routeState.activityId === selectedActivity?.id ? routeState : null;
  const spoons = '🥄'.repeat(energy.level);

  return (
    <>
    <div className="container">
      <img src={logo} className="img-fluid" alt="Logo GoodMaps" />

      <div className="energy-pill">
        <span aria-hidden="true">{spoons}</span>
        <span>
          {energy.label} · rayon {formatDistance(energy.maxDistanceMeters)}
        </span>
        <button type="button" className="energy-pill__edit" onClick={() => navigate('/')}>
          Modifier
        </button>
      </div>

      {weather && <WeatherBanner weather={weather} hasResults={activities.length > 0 && !isSearching} />}

      <button
        onClick={handleGetSuggestions}
        className={`suggestButton ${!isMapReady || isSearching ? 'disabled' : ''}`}
        disabled={!isMapReady || isSearching}
      >
        {isSearching ? `Recherche en cours… (${activities.length}/5)` : 'Cliquez ici pour obtenir des suggestions'}
      </button>

      {error && <p className="search-error" role="alert">{error}</p>}

      <div className="map-stage">
        <GoogleMapComponent
          ref={mapRef}
          activities={activities}
          selectedActivityId={selectedActivity?.id ?? null}
          userLocation={userLocation}
          reachRadiusMeters={energy.maxDistanceMeters}
          routeSegments={route?.status === 'ready' ? route.result.segments : null}
          onMarkerClick={handleMarkerClick}
          onMapLoad={() => setIsMapReady(true)}
          onBoundsChange={setBounds}
        />
        {isSearching && (
          <div className="map-stage__status" aria-live="polite">
            {revealing ? (
              <>
                <span className="map-stage__new">Nouvelle idée</span> {revealing.emoji} {revealing.name}
              </>
            ) : (
              <>
                <span className="map-stage__dot" aria-hidden="true" /> L’IA cherche des idées adaptées à votre énergie…
              </>
            )}
          </div>
        )}
      </div>

      {selectedActivity && (
        <div ref={activityInfoRef} className="activity-info">
          <h2>Détails de l'activité</h2>
          {selectedActivity.photo && (
            <figure className="activity-photo">
              <img src={selectedActivity.photo.url} alt={selectedActivity.photo.title} />
              <figcaption>
                Photo : <a href={selectedActivity.photo.pageUrl} target="_blank" rel="noopener noreferrer">Wikipédia</a>
              </figcaption>
            </figure>
          )}
          <p className='activityName'><strong> {selectedActivity.emoji} {selectedActivity.name} </strong></p>

          <ul className="activity-badges">
            {selectedActivity.distanceMeters !== undefined &&
              (isBeyondReach(selectedActivity.distanceMeters, energy) ? (
                <li className="is-far">📍 à {formatDistance(selectedActivity.distanceMeters)} · au-delà de votre rayon</li>
              ) : (
                <li>📍 à {formatDistance(selectedActivity.distanceMeters)}</li>
              ))}
            {selectedActivity.setting && <li>{SETTING_LABELS[selectedActivity.setting]}</li>}
            {selectedActivity.duration_minutes && <li>⏱ {selectedActivity.duration_minutes} min</li>}
            {selectedActivity.intensity && <li>💪 {selectedActivity.intensity}</li>}
            {selectedActivity.seating && <li>🪑 Places assises</li>}
          </ul>

          {selectedActivity.why && <p className="activity-why">✨ {selectedActivity.why}</p>}
          <p>{selectedActivity.description}</p>
          {selectedActivity.opening_hours && (
            <p className='activityOpening'><strong>Horaires d'ouverture :</strong> {selectedActivity.opening_hours}</p>
          )}
          {selectedActivity.booking_link && (
            <span><a href={selectedActivity.booking_link} target="_blank" rel="noopener noreferrer" className='link'><img src={AddCircleIcon} alt="Reserver" /> Reserver</a></span>
          )}
          &nbsp;
          {selectedActivity.phone_number && (
            <span><a href={`tel:${selectedActivity.phone_number}`} className='link'><img src={PlayCircleIcon} alt="Appeler" /> Appeler</a></span>
          )}

          {route?.status === 'ready' ? (
            <RoutePanel
              route={route.result}
              energy={energy}
              fromUserLocation={userLocation !== null}
              onClose={() => setRouteState(null)}
            />
          ) : (
            <button
              type="button"
              className="route-button"
              onClick={handleShowRoute}
              disabled={route?.status === 'loading'}
            >
              {route?.status === 'loading' ? 'Calcul du trajet et des pentes…' : '♿ Voir le trajet accessible et ses pentes'}
            </button>
          )}
          {route?.status === 'error' && (
            <p className="search-error" role="alert">Impossible de calculer le trajet pour le moment.</p>
          )}
        <h6>L'IA peut faire des erreurs. Envisagez de vérifier les informations importantes.</h6>
        </div>
      )}
      </div>
    </>
  );
};

export default MapPage;
