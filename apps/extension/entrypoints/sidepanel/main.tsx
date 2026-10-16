import '../../lib/node-globals';
import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { App } from '../popup/App';

createRoot(document.getElementById('root')!).render(<App />);
