// Graveward bootstrap. See src/game.js for the game shell.
import { Game } from './src/game.js';
import * as Sprites from './src/sprites.js';

const canvas = document.getElementById('screen');
const params = new URLSearchParams(location.search);
try {
  const game = new Game(canvas, params);
  window.graveward = game;
  Sprites.warm();
  game.start();
  canvas.focus();
  // Automation / quick-start hooks for testing: ?auto=1 starts a match immediately.
  if (params.get('auto') === '1') {
    const humans = params.get('humans') === '0' ? 0 : Math.max(1, +(params.get('humans') || 1));
    const total = Math.max(2, Math.min(4, +(params.get('players') || 4)));
    const devs = ['kbm1', 'kb2', 'pad0', 'pad1'];
    const cfg = [];
    for (let i = 0; i < total; i++) cfg.push(i < humans ? { human: true, device: devs[i], name: 'PLAYER ' + (i + 1), godId: ['ossuar', 'vorrath', 'ashkeleth'][i % 3] } : { human: false });
    game.startMatch(cfg);
  }
} catch (e) {
  console.error(e);
  document.getElementById('fallback').style.display = 'block';
}
