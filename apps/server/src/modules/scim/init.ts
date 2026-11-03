// Directory groups shown beside the groups made in Freero (#63), read-only: workspaces asks through
// its seam so it never imports this module.
import { setDirectoryGroupReader } from '../workspaces/index';
import { directoryGroupsOf } from './index';

export default function initScim(): void {
  setDirectoryGroupReader(directoryGroupsOf);
}
