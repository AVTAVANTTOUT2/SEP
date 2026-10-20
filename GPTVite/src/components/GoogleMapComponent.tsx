import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, LatLng } from '../types';
import { MapBounds } from '../controllers/apiServiceGPT';
import { RouteSegment } from '../controllers/routeService';
import { prefersReducedMotion } from '../geo';

interface GoogleMapComponentProps {
  activities: Activity[];
  selectedActivityId?: string | null;
  userLocation?: LatLng | null;
  reachRadiusMeters?: number; // rayon atteignable selon l'énergie du jour
  routeSegments?: RouteSegment[] | null;
  onMarkerClick: (activity: Activity) => void;
  onMapLoad: () => void;
  onMapDragEnd?: () => void;
  onBoundsChange: (bounds: MapBounds) => void;
}

// Pilotage de la caméra depuis la page (survol des lieux pendant le streaming)
export interface MapHandle {
  flyTo: (position: LatLng, zoom?: number) => void;
  fitPoints: (points: LatLng[]) => void;
  getCenter: () => LatLng | null;
}

const PARIS: L.LatLngExpression = [48.8566, 2.3522];
const FLY_DURATION_SECONDS = 0.9;
const FIT_PADDING: L.PointExpression = [48, 48];

// Bulle du repère : photo du lieu si on en a une, sinon son emoji
function markerElement(activity: Activity): HTMLElement {
  const pin = document.createElement('div');
  pin.className = 'gm-pin';

  const bubble = document.createElement('div');
  bubble.className = 'gm-pin__bubble';
  if (activity.photo) {
    const img = document.createElement('img');
    img.src = activity.photo.url;
    img.alt = '';
    bubble.appendChild(img);
  } else {
    bubble.classList.add('gm-pin__bubble--emoji');
    bubble.textContent = activity.emoji ?? (activity.name.charAt(0).toUpperCase() || '•');
  }

  const label = document.createElement('div');
  label.className = 'gm-pin__label';
  label.textContent = activity.name;

  pin.append(bubble, label);
  return pin;
}

function moveToPoints(map: L.Map, points: LatLng[]) {
  if (points.length === 0) return;
  const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple));
  const options = { padding: FIT_PADDING, maxZoom: 16 };
  if (prefersReducedMotion()) map.fitBounds(bounds, options);
  else map.flyToBounds(bounds, { ...options, duration: FLY_DURATION_SECONDS });
}

const userIcon = L.divIcon({
  className: 'gm-user',
  html: '<span class="gm-user__pulse"></span><span class="gm-user__dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const GoogleMapComponent = forwardRef<MapHandle, GoogleMapComponentProps>(
  (
    {
      activities,
      selectedActivityId = null,
      userLocation = null,
      reachRadiusMeters = 2000,
      routeSegments = null,
      onMarkerClick,
      onMapLoad,
      onMapDragEnd,
      onBoundsChange,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markersRef = useRef<L.LayerGroup | null>(null);
    const markerByIdRef = useRef(new Map<string, L.Marker>());
    const userLayerRef = useRef<L.LayerGroup | null>(null);
    const routeLayerRef = useRef<L.LayerGroup | null>(null);
    const onMarkerClickRef = useRef(onMarkerClick);
    const onMapLoadRef = useRef(onMapLoad);
    const onMapDragEndRef = useRef(onMapDragEnd);
    const onBoundsChangeRef = useRef(onBoundsChange);

    onMarkerClickRef.current = onMarkerClick;
    onMapLoadRef.current = onMapLoad;
    onMapDragEndRef.current = onMapDragEnd;
    onBoundsChangeRef.current = onBoundsChange;

    useImperativeHandle(ref, () => ({
      flyTo: (position, zoom = 16) => {
        const map = mapRef.current;
        if (!map) return;
        if (prefersReducedMotion()) map.setView(position, zoom);
        else map.flyTo(position, zoom, { duration: FLY_DURATION_SECONDS });
      },
      fitPoints: (points) => {
        if (mapRef.current) moveToPoints(mapRef.current, points);
      },
      getCenter: () => {
        const center = mapRef.current?.getCenter();
        return center ? { lat: center.lat, lng: center.lng } : null;
      },
    }));

    useEffect(() => {
      const el = containerRef.current;
      if (!el || mapRef.current) return;

      const map = L.map(el).setView(PARIS, 10);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      userLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      markersRef.current = L.layerGroup().addTo(map);

      const emitBounds = () => {
        const bounds = map.getBounds();
        onBoundsChangeRef.current({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      };

      map.whenReady(() => {
        onMapLoadRef.current();
        emitBounds();
      });
      map.on('moveend', emitBounds);
      map.on('dragend', () => onMapDragEndRef.current?.());

      mapRef.current = map;
      const markerById = markerByIdRef.current;
      return () => {
        map.remove();
        mapRef.current = null;
        markersRef.current = null;
        userLayerRef.current = null;
        routeLayerRef.current = null;
        markerById.clear();
      };
    }, []);

    // Position de l'utilisateur et cercle de ce qui est atteignable avec l'énergie du jour
    useEffect(() => {
      const map = mapRef.current;
      const layer = userLayerRef.current;
      if (!map || !layer || !userLocation) return;
      layer.clearLayers();
      L.circle(userLocation, {
        radius: reachRadiusMeters,
        className: 'gm-reach',
        interactive: false,
      }).addTo(layer);
      L.marker(userLocation, { icon: userIcon, interactive: false, keyboard: false }).addTo(layer);
      map.fitBounds(L.latLng(userLocation).toBounds(reachRadiusMeters * 2), { padding: FIT_PADDING });
    }, [userLocation, reachRadiusMeters]);

    // Les activités arrivent une par une : on n'ajoute que les nouvelles pour ne rejouer l'animation qu'une fois
    useEffect(() => {
      const group = markersRef.current;
      if (!group) return;
      const markerById = markerByIdRef.current;
      const ids = new Set(activities.map((activity) => activity.id));

      markerById.forEach((marker, id) => {
        if (!ids.has(id)) {
          group.removeLayer(marker);
          markerById.delete(id);
        }
      });

      for (const activity of activities) {
        if (markerById.has(activity.id)) continue;
        const marker = L.marker([activity.lat, activity.lng], {
          icon: L.divIcon({ className: 'gm-marker', html: markerElement(activity), iconSize: [48, 56], iconAnchor: [24, 56] }),
          title: activity.name,
          riseOnHover: true,
        })
          .on('click', () => onMarkerClickRef.current(activity))
          .addTo(group);
        markerById.set(activity.id, marker);
      }
    }, [activities]);

    useEffect(() => {
      markerByIdRef.current.forEach((marker, id) => {
        const selected = id === selectedActivityId;
        marker.getElement()?.classList.toggle('is-selected', selected);
        marker.setZIndexOffset(selected ? 1000 : 0);
      });
    }, [selectedActivityId, activities]);

    // Tracé coloré selon la pente
    useEffect(() => {
      const map = mapRef.current;
      const layer = routeLayerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();
      if (!routeSegments?.length) return;

      for (const segment of routeSegments) {
        L.polyline(segment.points, { className: 'gm-route-halo', interactive: false }).addTo(layer);
      }
      for (const segment of routeSegments) {
        L.polyline(segment.points, { className: `gm-route gm-route--${segment.level}`, interactive: false }).addTo(layer);
      }
      moveToPoints(map, routeSegments.flatMap((segment) => segment.points));
    }, [routeSegments]);

    return <div ref={containerRef} className="osm-map" role="application" aria-label="Carte des activités" />;
  }
);

export default GoogleMapComponent;
