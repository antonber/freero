// Public API of modules/moderation [S2]: abuse reports, the operator queue, operator actions and
// appeals (KAI-142). It owns the queue and the action record; the moderated state itself lives in
// the owning modules (boards, uploads, auth), which it calls through their indexes.
export { isOperator, onModerationAction, type ModerationActionListener } from './service';
