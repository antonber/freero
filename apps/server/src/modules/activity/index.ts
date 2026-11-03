// Public API of modules/activity [S2]: the activity feed (what people did on boards). Its sources
// are trusted server events it subscribes to in init.ts (realtime's element changes and comment
// messages, members' sharing events); its REST API is routes.ts. A new source emits an event of
// its own module and activity listens.
// What others changed on someone's boards since a moment (the "changes on your boards" email,
// modules/notifications), by the same rules as "changes since your last visit".
export { boardChangesSince, type BoardChanges } from './catchUp';
// The change set since the last visit or a moment, as the reader may see the board: what the AI
// catch-up (modules/ai, #126) summarises, and nothing else.
export { catchUpChanges } from './catchUp';
// The burst writer itself: init.ts feeds it realtime's element changes; other modules' tests
// drive it directly with changes of their own, then flush what ended.
export { recordChanges as recordBoardChanges, flushBursts as flushActivityBursts } from './service';
