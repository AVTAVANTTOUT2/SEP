import React from 'react';
import { ENERGY_PROFILES, getEnergyProfile } from '../energy';

interface EnergyGaugeProps {
  value: number;
  onChange: (level: number) => void;
}

// Jauge « énergie du jour » : chaque cuillère représente une part d'énergie disponible
const EnergyGauge: React.FC<EnergyGaugeProps> = ({ value, onChange }) => {
  const profile = getEnergyProfile(value);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(ENERGY_PROFILES.length, value + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(1, value - 1));
    }
  };

  return (
    <fieldset className="energy-gauge">
      <legend>Combien de cuillères aujourd’hui ?</legend>
      <p className="energy-gauge__intro">
        Chaque sortie coûte de l’énergie : c’est la « théorie des cuillères ». Indiquez combien il vous en reste,
        on adapte la distance, la durée et les pauses.
      </p>
      <div className="energy-gauge__spoons" role="radiogroup" aria-label="Énergie du jour" onKeyDown={handleKeyDown}>
        {ENERGY_PROFILES.map(({ level, label }) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={level === value}
            aria-label={`${level} cuillère${level > 1 ? 's' : ''} : ${label}`}
            tabIndex={level === value ? 0 : -1}
            className={`energy-gauge__spoon ${level <= value ? 'is-filled' : ''}`}
            onClick={() => onChange(level)}
          >
            🥄
          </button>
        ))}
      </div>
      <p className="energy-gauge__label" aria-live="polite">
        <strong>{profile.label}</strong> · {profile.hint}
      </p>
    </fieldset>
  );
};

export default EnergyGauge;
