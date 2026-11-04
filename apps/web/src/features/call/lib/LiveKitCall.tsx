// The board's room on the operator's LiveKit server (#149), through livekit-client (Apache-2.0,
// loaded only when someone joins). The token comes from Freero's server, for this board's room
// only; audio and video go between the browser and the operator's LiveKit, never through Freero.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from 'lucide-react';
import type { BoardCallToken } from '@freero/shared';
import { IconButton, initials } from '@ui';
import type { Participant, Room, Track, TrackPublication } from 'livekit-client';
import { t } from '../messages';

type LiveKitToken = Extract<BoardCallToken, { provider: 'livekit' }>;

interface Tile {
  key: string;
  name: string;
  local: boolean;
  speaking: boolean;
  muted: boolean;
  video: Track | null;
  screen: boolean;
}

/** Each participant's camera (or a name card), plus a tile per shared screen. */
function tilesOf(room: Room, Source: typeof Track.Source): Tile[] {
  const people: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  const live = (p: TrackPublication | undefined) => (p && !p.isMuted && p.track ? p.track : null);
  return people.flatMap((p) => {
    const name = p.name || p.identity;
    const mic = p.getTrackPublication(Source.Microphone);
    const base: Tile = {
      key: `${p.identity}:camera`,
      name,
      local: p === room.localParticipant,
      speaking: p.isSpeaking,
      muted: !mic || mic.isMuted,
      video: live(p.getTrackPublication(Source.Camera)),
      screen: false,
    };
    const screen = live(p.getTrackPublication(Source.ScreenShare));
    return screen ? [{ ...base, key: `${p.identity}:screen`, video: screen, screen: true }, base] : [base];
  });
}

function VideoTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !tile.video) return;
    tile.video.attach(el);
    return () => void tile.video?.detach(el);
  }, [tile.video]);
  return (
    <figure className={`fr-call-dock__tile${tile.speaking ? ' is-speaking' : ''}${tile.screen ? ' is-screen' : ''}`}>
      {tile.video ? <video ref={ref} autoPlay playsInline muted={tile.local} /> : <span className="fr-call-dock__initials">{initials(tile.name)}</span>}
      <figcaption>
        {tile.screen ? t('nameSScreen', { name: tile.name }) : tile.local ? t('youName', { name: tile.name }) : tile.name}
        {tile.muted && !tile.screen ? <MicOff size={11} aria-label={t('muted')} /> : null}
      </figcaption>
    </figure>
  );
}

export function LiveKitCall({ token, onLeave, onError }: { token: LiveKitToken; onLeave: () => void; onError: (message: string) => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [me, setMe] = useState({ mic: false, cam: false, screen: false });
  const audio = useRef<HTMLDivElement>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;
  const fail = useRef(onError);
  fail.current = onError;

  useEffect(() => {
    let current: Room | null = null;
    let gone = false;
    void (async () => {
      const lk = await import('livekit-client');
      if (gone) return;
      const r = new lk.Room({ adaptiveStream: true, dynacast: true });
      current = r;
      const refresh = () => {
        setTiles(tilesOf(r, lk.Track.Source));
        setMe({ mic: r.localParticipant.isMicrophoneEnabled, cam: r.localParticipant.isCameraEnabled, screen: r.localParticipant.isScreenShareEnabled });
      };
      r.on(lk.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === lk.Track.Kind.Audio && audio.current) audio.current.appendChild(track.attach());
        refresh();
      });
      r.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) el.remove();
        refresh();
      });
      for (const e of [
        lk.RoomEvent.ParticipantConnected,
        lk.RoomEvent.ParticipantDisconnected,
        lk.RoomEvent.LocalTrackPublished,
        lk.RoomEvent.LocalTrackUnpublished,
        lk.RoomEvent.TrackMuted,
        lk.RoomEvent.TrackUnmuted,
        lk.RoomEvent.ActiveSpeakersChanged,
        lk.RoomEvent.ParticipantNameChanged,
      ])
        r.on(e, refresh);
      r.on(lk.RoomEvent.Disconnected, () => {
        if (!gone) leave.current();
      });
      try {
        await r.connect(token.url, token.token);
      } catch {
        if (!gone) fail.current(t('couldNotReachTheCall'));
        return;
      }
      if (gone) return void r.disconnect();
      setRoom(r);
      refresh();
      // The microphone on by default, like a meeting; no device (or no permission) is not an error.
      await r.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      refresh();
    })();
    return () => {
      gone = true;
      void current?.disconnect();
    };
  }, [token.url, token.token]);

  const toggle = async (what: 'mic' | 'cam' | 'screen') => {
    if (!room) return;
    const p = room.localParticipant;
    try {
      if (what === 'mic') await p.setMicrophoneEnabled(!me.mic);
      else if (what === 'cam') await p.setCameraEnabled(!me.cam);
      else await p.setScreenShareEnabled(!me.screen);
    } catch {
      onError(what === 'screen' ? t('couldNotShareYourScreen') : t('couldNotUseYourCameraOr'));
    }
    setMe({ mic: p.isMicrophoneEnabled, cam: p.isCameraEnabled, screen: p.isScreenShareEnabled });
  };

  return (
    <>
      <div className="fr-call-dock__tiles" aria-live="polite">
        {room ? tiles.map((tile) => <VideoTile key={tile.key} tile={tile} />) : <p className="fr-call-dock__status">{t('connecting')}</p>}
      </div>
      <div ref={audio} hidden />
      <div className="fr-call-dock__controls" role="toolbar" aria-label={t('callControls')}>
        <IconButton icon={me.mic ? Mic : MicOff} label={me.mic ? t('muteMicrophone') : t('unmuteMicrophone')} active={me.mic} disabled={!room} onClick={() => void toggle('mic')} />
        <IconButton icon={me.cam ? Video : VideoOff} label={me.cam ? t('turnCameraOff') : t('turnCameraOn')} active={me.cam} disabled={!room} onClick={() => void toggle('cam')} />
        <IconButton icon={MonitorUp} label={me.screen ? t('stopSharingYourScreen') : t('shareYourScreen')} active={me.screen} disabled={!room} onClick={() => void toggle('screen')} />
        <IconButton icon={PhoneOff} label={t('leaveCall')} className="fr-call-dock__leave" onClick={onLeave} />
      </div>
    </>
  );
}
