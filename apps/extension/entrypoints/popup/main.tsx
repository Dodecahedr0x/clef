import '../../lib/node-globals';
import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { App } from './App';

// Opened in a tab (#tab, or #import-key to drop a key file): fill the tab like the side panel does, centred.
if (location.hash) {
  document.documentElement.classList.add('panel', 'tab');
  const root = document.getElementById('root')!;
  root.style.width = '100vw';
  root.style.height = '100vh';
}

createRoot(document.getElementById('root')!).render(<App />);
