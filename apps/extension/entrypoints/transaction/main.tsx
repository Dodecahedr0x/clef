import '../../lib/node-globals';
import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { TxDetail } from './TxDetail';

createRoot(document.getElementById('root')!).render(<TxDetail />);
