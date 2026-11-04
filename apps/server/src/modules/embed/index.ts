// Public API of modules/embed [S2]: who a board embedded on another site signed in as. The apps on
// other platforms (modules/zoom) accept the embed's board-bound token where the session cookie
// can't reach (a frame of another site).
export { memberOf } from './public';
