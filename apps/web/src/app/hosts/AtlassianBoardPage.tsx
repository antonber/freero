// Route /atlassian/b/:id[?item=…][&theme=light|dark] — a Freero board in a Confluence page (the
// Freero macro) or a Jira issue (the Freero issue panel; #166, #167). The Forge app's own frame
// frames this page, and the server lets only Atlassian's hosts do so while the board allows
// embedding. It is the public embed (PublicEmbed): each reader sees the board as Freero shares it
// with them, signs in through Freero's own window, and starts editing with a click on the uncovered
// frame (any Forge app can frame this page, so the plain embed's check stays). `item` opens the
// board at that frame or item (a Jira issue's linked card); `theme` is Atlassian's colour mode.
import { useParams } from 'react-router-dom';
import { PublicEmbed, popupSignIn } from '../embed/PublicEmbedPage';

export default function AtlassianBoardPage() {
  const { id = '' } = useParams();
  const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
  return <PublicEmbed id={id} readonly={false} signIn={popupSignIn} theme={theme} />;
}
