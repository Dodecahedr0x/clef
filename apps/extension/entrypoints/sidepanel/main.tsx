import '../../lib/node-globals';
import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { PanelRoot } from './PanelRoot';

createRoot(document.getElementById('root')!).render(<PanelRoot />);
