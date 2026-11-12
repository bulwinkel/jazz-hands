import './style.css';
import { parseOptions } from './config';
import { ZoneTestPage } from './page';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The page root is missing.');
new ZoneTestPage(root, parseOptions(location.search));
