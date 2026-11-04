// Route /meet/stage/:id — the Freero add-on's main stage in a Google Meet call (#169): the board's
// public embed (PublicEmbed) for everyone who joined the activity, each with their own access (a
// board anyone with its link may view shows read-only to people without an account; others sign in
// through Freero's own window). Only Google Meet can frame this page (the server allows no other
// ancestor), so editing starts at once for people who may edit.
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PublicEmbed, popupSignIn } from '../../embed/PublicEmbedPage';
import { connectMeet } from './meetSdk';

export default function MeetStagePage() {
  const { id = '' } = useParams();
  // The stage must create its own add-on session, or Meet doesn't start it.
  useEffect(() => void connectMeet('mainStage'), []);
  return <PublicEmbed id={id} readonly={false} theme="light" signIn={popupSignIn} editDirectly />;
}
