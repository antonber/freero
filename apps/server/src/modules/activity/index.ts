// Public API of modules/activity [S2]: the activity feed (what people did on boards). Its sources
// are trusted server events it subscribes to in init.ts (realtime's element changes and comment
// messages, members' sharing events); its REST API is routes.ts. Nothing to call from outside yet:
// a new source emits an event of its own module and activity listens.
export {};
