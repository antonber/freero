// How frames read in the board outline: a titled container (its children are the elements whose
// frameId is the frame). A hidden frame says so; its contents reach only owners and editors.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { frame: (el) => ({ title: el.title, hidden: !!el.hidden, standalone: true }) },
});
