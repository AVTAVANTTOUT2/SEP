import React from 'react';
import { ElevationSample, gradeLevel } from '../controllers/routeService';

interface ElevationChartProps {
  samples: ElevationSample[];
  grades: number[];
  alertDistance?: number;
}

const WIDTH = 300;
const HEIGHT = 80;
const PADDING_Y = 6;
const MIN_RANGE_METERS = 10; // un trajet plat doit rester visuellement plat

// Profil d'altitude du trajet, coloré selon la pente
const ElevationChart: React.FC<ElevationChartProps> = ({ samples, grades, alertDistance }) => {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const total = last.distance || 1;

  const elevations = samples.map((sample) => sample.elevation);
  const lowest = Math.min(...elevations);
  const highest = Math.max(...elevations);
  const middle = (lowest + highest) / 2;
  const min = Math.min(lowest, middle - MIN_RANGE_METERS / 2);
  const max = Math.max(highest, middle + MIN_RANGE_METERS / 2);

  const x = (distance: number) => (distance / total) * WIDTH;
  const y = (elevation: number) => PADDING_Y + (1 - (elevation - min) / (max - min)) * (HEIGHT - 2 * PADDING_Y);

  const line = samples
    .map((sample, i) => `${i ? 'L' : 'M'}${x(sample.distance).toFixed(1)},${y(sample.elevation).toFixed(1)}`)
    .join(' ');

  return (
    <figure className="elevation-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Profil d’altitude du trajet : de ${Math.round(lowest)} à ${Math.round(highest)} mètres`}
      >
        <path d={`${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`} className="elevation-chart__area" />
        {grades.map((grade, i) => (
          <line
            key={i}
            x1={x(samples[i].distance)}
            y1={y(samples[i].elevation)}
            x2={x(samples[i + 1].distance)}
            y2={y(samples[i + 1].elevation)}
            className={`elevation-chart__segment elevation-chart__segment--${gradeLevel(grade)}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {alertDistance !== undefined && (
          <line
            x1={x(alertDistance)}
            x2={x(alertDistance)}
            y1={0}
            y2={HEIGHT}
            className="elevation-chart__alert"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption className="elevation-chart__axis">
        <span>Départ · {Math.round(first.elevation)} m</span>
        <span>Arrivée · {Math.round(last.elevation)} m</span>
      </figcaption>
    </figure>
  );
};

export default ElevationChart;
