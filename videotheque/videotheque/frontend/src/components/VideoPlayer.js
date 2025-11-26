import React, { useState, useEffect } from 'react';

const VideoPlayer = () => {
  const [hasAccess, setHasAccess] = useState(false);
  const [code, setCode] = useState('');
  const [videos, setVideos] = useState([]);
  const [accessMap, setAccessMap] = useState({}); // videoId -> { url, expiresAt }
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('http://localhost:3001/api/videos')
      .then((res) => res.json())
      .then((data) => setVideos(data));
  }, []);

  const handleValidate = async () => {
    // keep the old validate API for a quick check if you like
    try {
      setError('');
      const res = await fetch('http://localhost:3001/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();
      if (data && data.valid) {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setError('Code invalide ou expiré.');
      }
    } catch (err) {
      setError('Erreur de validation');
      console.error(err);
    }
  };

  const requestAccess = async (videoId) => {
    try {
      setError('');
      const res = await fetch(`http://localhost:3001/api/videos/${videoId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || res.statusText);
      }

      const { accessUrl, expiresIn } = await res.json();
      const full = accessUrl.startsWith('http') ? accessUrl : `http://localhost:3001${accessUrl}`;
      setAccessMap((m) => ({ ...m, [videoId]: { url: full, expiresAt: Date.now() + expiresIn * 1000 } }));
      setHasAccess(true);
    } catch (err) {
      console.error('requestAccess failed', err);
      setError(err.message || 'Failed to get access');
    }
  };

  return (
    <div style={{ marginTop: '30px' }}>
      <h2>Visionnement Complet</h2>
          {!hasAccess ? (
        <div>
          <p>Entrez un code d’accès (valable 1h) :</p>
          <input value={code} onChange={(e) => setCode(e.target.value)} />
          <button onClick={handleValidate}>Valider</button>
          {error ? <div style={{ color: 'red', marginTop: 8 }}>{error}</div> : null}
        </div>
      ) : (
        videos.map((video) => (
          <div key={video.id} style={{ marginBottom: '20px' }}>
            <h3>{video.title}</h3>
            {!accessMap[video.id] ? (
              <div>
                <button onClick={() => requestAccess(video.id)}>Demander l'accès pour 1h</button>
                {error ? <div style={{ color: 'red', marginTop: 8 }}>{error}</div> : null}
              </div>
            ) : (
              <iframe
                src={accessMap[video.id].url}
                width="640"
                height="360"
                allow="autoplay; fullscreen"
                title={video.title}
              ></iframe>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default VideoPlayer;