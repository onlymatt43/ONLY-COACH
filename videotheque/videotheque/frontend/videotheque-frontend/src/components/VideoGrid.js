import React from 'react';

const mockVideos = [
  { id: 1, title: 'Connexion Sensuelle', category: 'Art Sensuel', preview: 'https://player.bunny.net/embed/12345' },
  { id: 2, title: 'Conscience du Corps', category: 'Pleine Conscience', preview: 'https://player.bunny.net/embed/67890' },
];

const VideoGrid = () => {
  return (
    <div>
      {['Art Sensuel', 'Pleine Conscience'].map((category) => (
        <div key={category}>
          <h2>{category}</h2>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {mockVideos
              .filter((video) => video.category === category)
              .map((video) => (
                <iframe
                  key={video.id}
                  src={video.preview}
                  title={video.title}
                  width="320"
                  height="180"
                  allow="autoplay; fullscreen"
                ></iframe>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VideoGrid;