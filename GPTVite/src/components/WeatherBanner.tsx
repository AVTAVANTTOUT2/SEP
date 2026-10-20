import React from 'react';
import { Weather } from '../types';

interface WeatherBannerProps {
  weather: Weather;
  hasResults: boolean;
}

const WeatherBanner: React.FC<WeatherBannerProps> = ({ weather, hasResults }) => {
  const { temperature, condition, emoji } = weather;

  let message: string;
  if (condition === 'chaleur') {
    message = hasResults
      ? `Il fait ${temperature} °C, je vous ai trouvé des endroits au frais.`
      : `Il fait ${temperature} °C : je privilégierai des endroits au frais (climatisés, ombragés ou en intérieur).`;
  } else if (condition === 'pluie') {
    message = hasResults
      ? `Il pleut (${temperature} °C), je vous ai trouvé des activités à l’abri.`
      : `Il pleut (${temperature} °C) : je chercherai des activités à l’abri.`;
  } else {
    message = `${temperature} °C, un temps agréable pour sortir.`;
  }

  return (
    <div className={`weather-banner weather-banner--${condition}`} role="status">
      <span className="weather-banner__emoji" aria-hidden="true">{emoji}</span>
      <div>
        <p className="weather-banner__message">{message}</p>
        {condition === 'chaleur' && (
          <p className="weather-banner__note">La chaleur peut accentuer les symptômes de la SEP (phénomène d’Uhthoff).</p>
        )}
      </div>
    </div>
  );
};

export default WeatherBanner;
