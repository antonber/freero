// Public API of modules/dlp [S2]: the optional sensitive-data scan of a team workspace's boards
// (#158; docs/design/compliance.md §2). It owns its settings and findings; boards keeps the label it
// gives (applyLabelByPolicy) and asks it before people relabel a board (onLabelChange, init.ts).
export { dlpConsumer, DLP_CONSUMER, guardLabelChange, scanBoard, sensitiveDataStatus, updateSensitiveDataSettings, boardSensitiveData } from './service';
