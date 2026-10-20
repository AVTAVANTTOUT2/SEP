import React from 'react';
import { MODERATE_GRADE, RouteResult } from '../controllers/routeService';
import { EnergyProfile, formatDistance, isBeyondReach } from '../energy';
import ElevationChart from './ElevationChart';

interface RoutePanelProps {
  route: RouteResult;
  energy: EnergyProfile;
  fromUserLocation: boolean;
  onClose: () => void;
}

const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};

const RoutePanel: React.FC<RoutePanelProps> = ({ route, energy, fromUserLocation, onClose }) => {
  const { alert } = route;
  const tooFar = isBeyondReach(route.distanceMeters, energy);

  let alertText = '';
  if (alert) {
    const what =
      alert.level === 'steep'
        ? `${alert.kind === 'montée' ? 'Montée' : 'Descente'} raide`
        : `${alert.kind === 'montée' ? 'Montée' : 'Descente'} marquée`;
    const where =
      alert.distanceFromStart < 30 ? 'dès le départ' : `dans ${formatDistance(Math.round(alert.distanceFromStart / 50) * 50)}`;
    alertText = `${what} (~${alert.grade} %) ${where}`;
  }

  return (
    <section className="route-panel" aria-label="Trajet accessible">
      <div className="route-panel__header">
        <h3>♿ Trajet à pied ou en fauteuil</h3>
        <button type="button" className="route-panel__close" onClick={onClose}>
          Masquer
        </button>
      </div>

      <dl className="route-panel__stats">
        <div>
          <dt>Distance</dt>
          <dd>{formatDistance(route.distanceMeters)}</dd>
        </div>
        <div>
          <dt>Durée à pied</dt>
          <dd>{formatDuration(route.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Dénivelé +</dt>
          <dd>{route.ascentMeters} m</dd>
        </div>
        <div>
          <dt>Pente max</dt>
          <dd>{route.maxGrade} %</dd>
        </div>
      </dl>

      {alert ? (
        <p className={`route-panel__alert route-panel__alert--${alert.level}`} role="alert">
          ⚠️ {alertText}
        </p>
      ) : (
        <p className="route-panel__alert route-panel__alert--ok">✅ Aucune pente au-delà de {MODERATE_GRADE} % détectée</p>
      )}

      {tooFar && (
        <p className="route-panel__energy">
          🥄 Ce trajet ({formatDistance(route.distanceMeters)}) dépasse votre énergie du jour (
          {formatDistance(energy.maxDistanceMeters)}). Pensez aux transports ou à un lieu plus proche.
        </p>
      )}

      <ElevationChart samples={route.samples} grades={route.grades} alertDistance={alert?.distanceFromStart} />

      <ul className="route-panel__legend">
        <li><span className="route-panel__swatch route-panel__swatch--ok" /> moins de 5 %</li>
        <li><span className="route-panel__swatch route-panel__swatch--moderate" /> 5 à 8 %</li>
        <li><span className="route-panel__swatch route-panel__swatch--steep" /> plus de 8 %</li>
      </ul>

      <p className="route-panel__note">
        Départ : {fromUserLocation ? 'votre position' : 'le centre de la carte (géolocalisation indisponible)'}.{' '}
        {route.elevationSource === 'ign'
          ? 'Altitudes IGN (RGE ALTI) : les marches et les bordures de trottoir ne sont pas détectées.'
          : 'Altitudes approximatives (modèle de terrain 90 m) : vérifiez les pentes sur place.'}
      </p>
    </section>
  );
};

export default RoutePanel;
