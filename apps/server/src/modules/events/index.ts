// Public API of modules/events [S2]: the event stream (KAI-150). Board, membership, item and
// comment events recorded once, in order, through the outbox; consumers (webhooks) follow
// `EVENT_RECORDED_TOPIC` on the outbox with their own cursor and read the events here.
export { EVENT_RECORDED_TOPIC, eventsByIds, eventsOfBoard, type StoredEvent } from './repo';
export { eventsConsumer, EVENTS_CONSUMER, deriveDueBoards, deriveBoardEvents } from './service';
