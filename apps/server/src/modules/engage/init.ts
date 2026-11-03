// Live activities at startup: a duplicated board's quizzes keep their answer keys (#147).
import type { ServerContext } from '../../platform/context';
import { onBoardLifecycle } from '../boards/index';
import { keysOnDuplicate } from './service';

export default function engageInit(_ctx: ServerContext): void {
  onBoardLifecycle((e) => (e.action === 'duplicated' ? keysOnDuplicate(e) : undefined));
}
