import './style.css';
import { DanceGame } from './game/flow';
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The game root is missing.');
new DanceGame(root);
