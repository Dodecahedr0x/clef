import { createRoot } from 'react-dom/client';
import '../../assets/tailwind.css';
import { HardwareApp } from './HardwareApp';

const kind = new URLSearchParams(location.search).get('kind');
createRoot(document.getElementById('root')!).render(<HardwareApp kind={kind === 'keystone' ? 'keystone' : 'ledger'} />);
