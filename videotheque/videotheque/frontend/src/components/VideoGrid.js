import React, { useEffect, useState } from 'react';

const VideoGrid = () => {
  const [videos, setVideos] = useState([]);

  useEffect(() => {
    fetch('http://localhost:3001/api/videos')
      .then((res) => res.json())
      .then((data) => setVideos(data));
  }, []);

  const categories = [...new Set(videos.map((v) => v.category))];

  return (
    <div>
      {categories.map((category) => (
        <div key={category}>
          <h2>{category}</h2>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {videos
              .filter((v) => v.category === category)
              .map((video) => (
                <iframe
                  key={video.id}
                  src={video.previewUrl}
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