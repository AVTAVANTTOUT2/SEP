import '../App.css';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo-goodmaps.png';
import EnergyGauge from '../components/EnergyGauge';
import { DEFAULT_ENERGY } from '../energy';
import { UserInfo } from '../types';

const Home: React.FC = () => {
  const [ability, setAbility] = useState('moteur');
  const [activityPreferences, setActivityPreferences] = useState('');
  const [energy, setEnergy] = useState(DEFAULT_ENERGY);
  const navigate = useNavigate();

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Redirection vers la page de la carte avec les infos utilisateur
    const userInfo: UserInfo = { ability, activityPreferences, energy };
    navigate('/map', { state: userInfo });
  };

  return (
    <div className="container">
      <img src={logo} className="img-fluid" alt="Logo GoodMaps" />
      <h1>Bienvenue sur GoodMaps !</h1>
      <p>Pour mieux personnaliser vos suggestions d'activités, merci de remplir ce formulaire.</p>
      <form onSubmit={handleFormSubmit}>
        <div>
          <label>
            Mes capacités :
            <select 
            className='form-select'
              value={ability} 
              onChange={(e) => setAbility(e.target.value)}
            >
                <option value="moteur">Handicap moteur</option>
                <option value="sensoriel">Handicap sensoriel</option>
                <option value="mental">Handicap mental</option>
                <option value="psychique">Handicap psychique</option>
                <option value="cognitif">Handicap cognitif</option>
                <option value="multi">Multi handicap</option>
                <option value="valide">Sans handicap</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            Préférences d'activités : 
            <input 
            className='form-control'
              type="text" 
              value={activityPreferences} 
              onChange={(e) => setActivityPreferences(e.target.value)} 
              placeholder="Ex: sport, art, nature..." 
            />
          </label>
        </div>
        <EnergyGauge value={energy} onChange={setEnergy} />
        <button type="submit" className='helloButton'>Passer à la carte</button>
      </form>
    </div>
  );
};

export default Home;
