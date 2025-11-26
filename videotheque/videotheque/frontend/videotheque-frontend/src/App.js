import React from 'react';
import VideoGrid from './components/VideoGrid';
import VideoPlayer from './components/VideoPlayer';
import Chatbot from './components/Chatbot';

function App() {
  return (
    <div>
      <h1 style={{ textAlign: 'center' }}>VIDÉOTHÈQUE byONLYMATT</h1>
      <VideoGrid />
      <VideoPlayer />
      <Chatbot />
    </div>
  );
}

export default App;