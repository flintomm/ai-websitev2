# Tower Defense Assets

This game loads art via paths in `pages/games/js/data/towers.js` and `pages/games/js/data/levels.js`.

## Backgrounds
- `pages/games/assets/backgrounds/Level2.png`

Update `pages/games/js/data/levels.js` to point to a different background or add more levels.

## Tower Sprites
Each tower expects:
- Idle: `frame_00.png`
- Shoot: `frame_01.png` to `frame_04.png`
- (Destroyed frames `05-07` are reserved for later use)

Current paths:
- `pages/games/assets/sprites/frames7/EarthTower2/frame_00.png`
- `pages/games/assets/sprites/frames7/EarthTower2/frame_01.png`
- ... etc

Update `pages/games/js/data/towers.js` to change sprite locations or use new art packs.

## Enemy Sprites (optional)
Enemy sprites are optional for now. If you add them, drop them under:
- `pages/games/assets/sprites/enemies/<type>/walk_00.png`

Then update `pages/games/js/data/enemies.js` and `pages/games/js/main.js` to render them.
