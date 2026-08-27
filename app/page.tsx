"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioPresets,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { TrackRenderer } from "../components/TrackRenderer";

type Preset = {
  id: string;
  name: string;
  description: string;
  resolution: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  hint: "detail" | "motion";
  degradation: RTCDegradationPreference;
  load: string;
};

type ParticipantView = {
  identity: string;
  name: string;
  sharing: boolean;
  local: boolean;
};

type RemoteMedia = {
  id: string;
  track: RemoteTrack;
  name: string;
  kind: Track.Kind;
  source: Track.Source;
};

type SavedSession = {
  roomId: string;
  name: string;
  participantId: string;
  maxParticipants: number;
  presetId: string;
};

type StreamStats = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  limitation?: string;
};

const SESSION_KEY = "passatela-active-session";
const PARTICIPANT_KEY = "passatela-participant-id";
const ROOM_LIMITS = [2, 4, 8, 12, 20];

const PRESETS: Preset[] = [
  {
    id: "low",
    name: "Baixa latência",
    description: "720p fluido e resposta rápida",
    resolution: "1280 × 720",
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 2,
    hint: "motion",
    degradation: "maintain-framerate",
    load: "Uso baixo de rede e processamento",
  },
  {
    id: "balanced",
    name: "Equilibrada",
    description: "1080p para uso geral",
    resolution: "1920 × 1080",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 6,
    hint: "detail",
    degradation: "balanced",
    load: "Uso moderado de rede e processamento",
  },
  {
    id: "high",
    name: "Alta qualidade",
    description: "1440p e movimento a 60 FPS",
    resolution: "2560 × 1440",
    width: 2560,
    height: 1440,
    fps: 60,
    bitrate: 18,
    hint: "motion",
    degradation: "maintain-framerate",
    load: "Uso alto de GPU e internet",
  },
  {
    id: "ultra",
    name: "Ultra",
    description: "4K priorizando máxima nitidez",
    resolution: "3840 × 2160",
    width: 3840,
    height: 2160,
    fps: 60,
    bitrate: 35,
    hint: "detail",
    degradation: "maintain-resolution",
    load: "Uso muito alto de GPU e internet",
  },
];

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getParticipantId() {
  const saved = localStorage.getItem(PARTICIPANT_KEY);
  if (saved) return saved;
  const generated = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(PARTICIPANT_KEY, generated);
  return generated;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    connected: "conectado",
    connecting: "conectando",
    reconnecting: "reconectando",
    disconnected: "desconectado",
  };
  return labels[status] || status;
}

export default function Home() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [createLimit, setCreateLimit] = useState(8);
  const [roomLimit, setRoomLimit] = useState(8);
  const [presetId, setPresetId] = useState("balanced");
  const [shareAudio, setShareAudio] = useState(false);
  const [publishedAudio, setPublishedAudio] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [localScreenTrack, setLocalScreenTrack] = useState<LocalVideoTrack | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<RemoteMedia[]>([]);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [status, setStatus] = useState("disconnected");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [theater, setTheater] = useState(false);
  const [canShareScreen, setCanShareScreen] = useState<boolean | null>(null);
  const roomRef = useRef<Room | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const connectingRef = useRef(false);
  const restoredRef = useRef(false);

  const preset = useMemo(
    () => PRESETS.find((item) => item.id === presetId) ?? PRESETS[1],
    [presetId],
  );
  const remoteVideos = remoteMedia.filter((item) => item.kind === Track.Kind.Video);
  const remoteAudios = remoteMedia.filter((item) => item.kind === Track.Kind.Audio);
  const screenCount = remoteVideos.length + (localScreenTrack ? 1 : 0);

  function syncParticipants(currentRoom: Room) {
    const toView = (participant: Participant, local: boolean): ParticipantView => ({
      identity: participant.identity,
      name: participant.name || participant.identity,
      sharing: participant.isScreenShareEnabled,
      local,
    });
    setParticipants([
      toView(currentRoom.localParticipant, true),
      ...Array.from(currentRoom.remoteParticipants.values()).map((participant) => toView(participant, false)),
    ]);
  }

  function addRemoteTrack(track: RemoteTrack, publication: RemoteTrackPublication, participant: Participant) {
    const trackSid = publication.trackSid;
    setRemoteMedia((current) => [
      ...current.filter((item) => item.id !== trackSid),
      {
        id: trackSid,
        track,
        name: participant.name || participant.identity,
        kind: track.kind,
        source: track.source,
      },
    ]);
  }

  async function connect(
    targetRoom: string,
    username: string,
    action: "create" | "join",
    maxParticipants: number,
    participantId: string,
    fromRestore = false,
  ) {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setError("");
    setStatus("connecting");

    try {
      const response = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: targetRoom,
          username,
          action,
          maxParticipants,
          participantId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao entrar na sala.");

      const currentRoom = new Room({ adaptiveStream: false, dynacast: true });
      currentRoom.on(RoomEvent.ConnectionStateChanged, (state) => setStatus(state.toLowerCase()));
      currentRoom.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => setAudioBlocked(!playing));
      currentRoom.on(RoomEvent.ParticipantConnected, () => syncParticipants(currentRoom));
      currentRoom.on(RoomEvent.ParticipantDisconnected, () => syncParticipants(currentRoom));
      currentRoom.on(RoomEvent.ParticipantNameChanged, () => syncParticipants(currentRoom));
      currentRoom.on(RoomEvent.TrackPublished, (publication) => {
        if (publication.kind === Track.Kind.Video) publication.setVideoQuality(VideoQuality.HIGH);
        syncParticipants(currentRoom);
      });
      currentRoom.on(RoomEvent.TrackUnpublished, () => syncParticipants(currentRoom));
      currentRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Video) publication.setVideoQuality(VideoQuality.HIGH);
        addRemoteTrack(track, publication, participant);
        syncParticipants(currentRoom);
      });
      currentRoom.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
        setRemoteMedia((current) => current.filter((item) => item.id !== publication.trackSid));
        syncParticipants(currentRoom);
      });
      currentRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          setLocalScreenTrack(null);
          setStreamStats(null);
          setNotice("");
        }
        if (publication.source === Track.Source.ScreenShareAudio) setPublishedAudio(false);
        syncParticipants(currentRoom);
      });
      currentRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source === Track.Source.ScreenShareAudio) setPublishedAudio(true);
        syncParticipants(currentRoom);
      });

      roomRef.current?.disconnect();
      await currentRoom.connect(data.url, data.token);
      roomRef.current = currentRoom;
      setName(username);
      setCode(targetRoom);
      setRoomId(targetRoom);
      setRoomLimit(Number(data.maxParticipants || maxParticipants));
      setStatus("connected");
      syncParticipants(currentRoom);
      try {
        await currentRoom.startAudio();
        setAudioBlocked(!currentRoom.canPlaybackAudio);
      } catch {
        setAudioBlocked(true);
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        roomId: targetRoom,
        name: username,
        participantId,
        maxParticipants: Number(data.maxParticipants || maxParticipants),
        presetId,
      } satisfies SavedSession));
      if (fromRestore) setNotice("Você voltou automaticamente para a sala.");
    } catch (cause) {
      setStatus("disconnected");
      setError(cause instanceof Error ? cause.message : "Não foi possível conectar à sala.");
      if (fromRestore) localStorage.removeItem(SESSION_KEY);
    } finally {
      connectingRef.current = false;
      setRestoring(false);
    }
  }

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    setCanShareScreen(Boolean(navigator.mediaDevices?.getDisplayMedia));
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as SavedSession;
      if (!saved.roomId || !saved.name || !saved.participantId) return;
      setName(saved.name);
      setCode(saved.roomId);
      setCreateLimit(saved.maxParticipants || 8);
      setPresetId(saved.presetId || "balanced");
      setRestoring(true);
      void connect(saved.roomId, saved.name, "join", saved.maxParticipants || 8, saved.participantId, true);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as SavedSession;
      saved.presetId = presetId;
      localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
    } catch {
      // A sessão continuará ativa mesmo se o armazenamento estiver indisponível.
    }
  }, [presetId, roomId]);

  useEffect(() => {
    if (!remoteAudios.length || !roomRef.current) return;
    const timer = window.setTimeout(() => {
      void roomRef.current?.startAudio()
        .then(() => setAudioBlocked(!roomRef.current?.canPlaybackAudio))
        .catch(() => setAudioBlocked(true));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [remoteAudios.length]);

  useEffect(() => {
    if (!localScreenTrack) {
      setStreamStats(null);
      return;
    }
    let previousBytes = 0;
    let previousTimestamp = 0;
    let active = true;

    const updateStats = async () => {
      const settings = localScreenTrack.mediaStreamTrack.getSettings();
      try {
        const reports = await localScreenTrack.getSenderStats();
        const report = reports.sort((a, b) => (b.frameWidth * b.frameHeight) - (a.frameWidth * a.frameHeight))[0];
        if (!active) return;
        let bitrate = 0;
        if (report?.bytesSent && previousBytes && previousTimestamp) {
          bitrate = ((report.bytesSent - previousBytes) * 8) / ((report.timestamp - previousTimestamp) / 1000) / 1_000_000;
        }
        previousBytes = report?.bytesSent || previousBytes;
        previousTimestamp = report?.timestamp || previousTimestamp;
        setStreamStats({
          width: report?.frameWidth || settings.width || 0,
          height: report?.frameHeight || settings.height || 0,
          fps: Math.round(report?.framesPerSecond || settings.frameRate || 0),
          bitrate: Math.max(0, bitrate),
          limitation: report?.qualityLimitationReason,
        });
      } catch {
        if (!active) return;
        setStreamStats({
          width: settings.width || 0,
          height: settings.height || 0,
          fps: Math.round(settings.frameRate || 0),
          bitrate: 0,
        });
      }
    };

    void updateStats();
    const interval = window.setInterval(() => void updateStats(), 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [localScreenTrack]);

  function enter(action: "create" | "join") {
    const username = name.normalize("NFKC").trim();
    const targetRoom = (action === "create" ? makeRoomCode() : code).trim().toUpperCase();
    if (username.length < 2) return setError("Digite um nome com pelo menos 2 caracteres.");
    if (targetRoom.length < 4) return setError("Digite um código de sala válido.");
    const participantId = getParticipantId();
    void connect(targetRoom, username, action, createLimit, participantId);
  }

  async function startScreen() {
    const currentRoom = roomRef.current;
    if (!currentRoom) return setError("A sala ainda está conectando.");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return setError("Este navegador não permite transmitir a tela. No celular, você ainda pode assistir às transmissões.");
    }
    setError("");
    setNotice("");
    try {
      const publication = await currentRoom.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: shareAudio ? {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2,
          } : false,
          video: true,
          resolution: { width: preset.width, height: preset.height, frameRate: preset.fps },
          contentHint: preset.hint,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          systemAudio: shareAudio ? "include" : "exclude",
          preferCurrentTab: shareAudio,
          suppressLocalAudioPlayback: false,
        },
        {
          source: Track.Source.ScreenShare,
          audioPreset: AudioPresets.musicHighQualityStereo,
          forceStereo: shareAudio,
          dtx: false,
          simulcast: true,
          degradationPreference: preset.degradation,
          screenShareEncoding: {
            maxBitrate: preset.bitrate * 1_000_000,
            maxFramerate: preset.fps,
            priority: preset.id === "low" ? "high" : "medium",
          },
        },
      );
      if (!publication?.track || publication.track.kind !== Track.Kind.Video) {
        throw new Error("O navegador não entregou uma faixa de vídeo.");
      }
      const videoTrack = publication.track as LocalVideoTrack;
      try {
        await videoTrack.mediaStreamTrack.applyConstraints({
          width: { ideal: preset.width, max: preset.width },
          height: { ideal: preset.height, max: preset.height },
          frameRate: { ideal: preset.fps, max: preset.fps },
        });
        await videoTrack.setDegradationPreference(preset.degradation);
      } catch {
        // Alguns navegadores aceitam o preset no envio, mas não em applyConstraints.
      }
      setLocalScreenTrack(videoTrack);
      syncParticipants(currentRoom);
      const audioPublished = Boolean(currentRoom.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio));
      setPublishedAudio(audioPublished);
      setNotice(
        `Transmitindo em ${preset.resolution} · até ${preset.fps} FPS${audioPublished ? " · áudio ativo" : shareAudio ? " · fonte sem áudio disponível" : ""}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A captura foi cancelada.");
    }
  }

  async function stopScreen() {
    await roomRef.current?.localParticipant.setScreenShareEnabled(false);
    setLocalScreenTrack(null);
    setPublishedAudio(false);
    setStreamStats(null);
    setNotice("");
    if (roomRef.current) syncParticipants(roomRef.current);
  }

  function leave() {
    void roomRef.current?.localParticipant.setScreenShareEnabled(false);
    roomRef.current?.disconnect();
    roomRef.current = null;
    localStorage.removeItem(SESSION_KEY);
    setRemoteMedia([]);
    setParticipants([]);
    setLocalScreenTrack(null);
    setPublishedAudio(false);
    setRoomId(null);
    setStatus("disconnected");
    setTheater(false);
    setNotice("");
  }

  async function togglePictureInPicture() {
    const video = stageRef.current?.querySelector<HTMLVideoElement>("video[data-pip-video]");
    if (!video) return setError("Inicie ou abra uma transmissão antes de usar Picture-in-Picture.");
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else {
        const safariVideo = video as HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void };
        if (!safariVideo.webkitSetPresentationMode) throw new Error();
        safariVideo.webkitSetPresentationMode("picture-in-picture");
      }
    } catch {
      setError("Picture-in-Picture não é permitido por este navegador para esta transmissão.");
    }
  }

  async function enableAudioPlayback() {
    if (!roomRef.current) return;
    try {
      await roomRef.current.startAudio();
      setAudioBlocked(!roomRef.current.canPlaybackAudio);
      if (roomRef.current.canPlaybackAudio) setNotice("Reprodução de áudio liberada neste dispositivo.");
    } catch {
      setError("O navegador ainda bloqueou o som. Toque novamente após interagir com a página.");
      setAudioBlocked(true);
    }
  }

  async function toggleFullscreen() {
    if (!stageRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current.requestFullscreen();
    } catch {
      const video = stageRef.current.querySelector<HTMLVideoElement>("video[data-pip-video]") as
        | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
        | null;
      if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else setError("Tela cheia não é permitida por este navegador.");
    }
  }

  if (!roomId) {
    return (
      <main className="shell landing-shell">
        <nav className="topbar">
          <div className="brand"><span className="brand-mark">↗</span><span>PassaTela</span></div>
          <span className="topbar-note"><span className="status-dot" /> simples · rápido · privado</span>
        </nav>
        <section className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">COMPARTILHAMENTO SEM COMPLICAÇÃO</p>
            <h1>Sua tela.<br /><em>Do seu jeito.</em></h1>
            <p className="hero-description">Uma sala leve para compartilhar tela e áudio com qualidade. Sem cadastro e sem distrações.</p>
            <div className="mini-features"><span>◉ Baixa latência</span><span>◉ Sem gravação automática</span><span>◉ Retorno automático à sala</span></div>
          </div>
          <div className="join-card">
            <div className="card-kicker">COMECE AGORA</div>
            <h2>{restoring ? "Voltando à sala" : "Entre em uma sala"}</h2>
            <p className="muted">{restoring ? "Reconectando sua sessão anterior…" : "Use um nome temporário para continuar."}</p>
            <label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Como quer ser chamado?" maxLength={32} disabled={restoring} /></label>
            <label>Código da sala<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ex.: A7K2Q9" maxLength={12} disabled={restoring} /></label>
            <label>Tamanho máximo da nova sala
              <select className="room-limit-select" value={createLimit} onChange={(event) => setCreateLimit(Number(event.target.value))} disabled={restoring}>
                {ROOM_LIMITS.map((limit) => <option value={limit} key={limit}>{limit} participantes</option>)}
              </select>
            </label>
            {error && <p className="feedback error">{error}</p>}
            <button className="button primary" onClick={() => enter("join")} disabled={restoring}>Entrar na sala <span>→</span></button>
            <div className="divider"><span>ou</span></div>
            <button className="button secondary" onClick={() => enter("create")} disabled={restoring}>Criar uma nova sala <span>＋</span></button>
            <p className="privacy-note">Nomes repetidos na mesma sala são bloqueados.</p>
          </div>
        </section>
        <footer className="footer"><span>PassaTela © 2026</span><span>Transmissão privada por padrão</span></footer>
      </main>
    );
  }

  return (
    <main className={`shell room-shell ${theater ? "theater-shell" : ""}`}>
      <nav className="topbar room-topbar">
        <div className="brand"><span className="brand-mark">↗</span><span>PassaTela</span></div>
        <div className="room-meta">
          <span className="live-pill"><span className="status-dot" /> {statusLabel(status)}</span>
          <span className="room-code">{roomId}</span>
          <button className="icon-button" title="Copiar código" onClick={() => navigator.clipboard?.writeText(roomId)}>⧉</button>
        </div>
      </nav>
      <section className={`room-layout ${theater ? "theater-layout" : ""}`}>
        <div className="stage-column">
          <div className="stage-header">
            <div><p className="eyebrow">SALA {roomId} · LIMITE {roomLimit}</p><h1>{screenCount ? `${screenCount} tela${screenCount > 1 ? "s" : ""} compartilhada${screenCount > 1 ? "s" : ""}` : "Pronto para compartilhar"}</h1></div>
            <span className="connection"><span className="status-dot" /> {participants.length}/{roomLimit} participantes</span>
          </div>
          <div className={`stage ${screenCount ? "stage-sharing" : ""}`} ref={stageRef}>
            {!screenCount && <div className="empty-stage"><div className="screen-icon">▣</div><h2>Nenhuma tela ativa</h2><p>Todos na sala podem compartilhar simultaneamente.</p></div>}
            {screenCount > 0 && <div className={`media-grid media-count-${Math.min(screenCount, 4)}`}>
              {localScreenTrack && <div className="media-tile local-media-tile"><TrackRenderer track={localScreenTrack} muted /><span className="tile-label">{name} · você</span></div>}
              {remoteVideos.map((item) => <div className="media-tile" key={item.id}><TrackRenderer track={item.track} /><span className="tile-label">{item.name}</span></div>)}
            </div>}
            {remoteAudios.map((item) => <TrackRenderer track={item.track} audio key={item.id} />)}
            <div className="stage-label">{streamStats
              ? <><span className="record-dot" /> envio real: {streamStats.width}×{streamStats.height} · {streamStats.fps} FPS · {streamStats.bitrate.toFixed(1)} Mbps</>
              : screenCount ? "recebendo transmissões da sala" : "nenhuma transmissão ativa"}</div>
          </div>
          <div className="view-controls">
            {remoteAudios.length > 0 && <button className={`view-button ${audioBlocked ? "sound-required" : "active"}`} onClick={enableAudioPlayback}>{audioBlocked ? "🔊 Ativar som" : "🔊 Som ativo"}</button>}
            <button className="view-button" onClick={togglePictureInPicture} disabled={!screenCount}>▱ Picture-in-Picture</button>
            <button className="view-button" onClick={toggleFullscreen} disabled={!screenCount}>⛶ Tela cheia</button>
            <button className={`view-button ${theater ? "active" : ""}`} onClick={() => setTheater((current) => !current)}>▰ Modo teatro</button>
          </div>
          {notice && <p className="feedback success">{notice}</p>}
          {error && <p className="feedback error">{error}</p>}
          {canShareScreen === false && <p className="mobile-share-note">Este navegador móvel não oferece captura de tela para sites. Você pode assistir normalmente; para transmitir a tela do celular será necessário um aplicativo Android/iOS no futuro.</p>}
          <div className="room-actions">
            <button className="button primary large" onClick={localScreenTrack ? stopScreen : startScreen} disabled={canShareScreen === false}>
              {localScreenTrack ? "Parar compartilhamento" : canShareScreen === false ? "Compartilhar indisponível neste celular" : "Compartilhar minha tela"}
              <span>{localScreenTrack ? "■" : "↗"}</span>
            </button>
            <button className="button secondary large" onClick={leave}>Sair da sala</button>
          </div>
        </div>
        <aside className="settings-panel">
          <div className="panel-heading"><div><p className="eyebrow">CONFIGURAÇÃO</p><h2>Transmissão</h2></div><span className="sliders">☷</span></div>
          <p className="muted panel-intro">Os presets agora alteram captura, FPS e limite real de bitrate.</p>
          <div className="preset-list">{PRESETS.map((item) => <button key={item.id} className={`preset ${presetId === item.id ? "selected" : ""}`} onClick={() => setPresetId(item.id)} disabled={Boolean(localScreenTrack)}><span className="radio">{presetId === item.id ? "●" : "○"}</span><span className="preset-text"><strong>{item.name}</strong><small>{item.description}</small><span className="preset-spec">{item.resolution} · {item.fps} FPS · até {item.bitrate} Mbps</span><small>{item.load}</small></span></button>)}</div>
          <label className="toggle-row"><span><strong>Compartilhar áudio</strong><small>Áudio da aba ou do sistema, quando disponível</small></span><input type="checkbox" checked={shareAudio} onChange={(event) => setShareAudio(event.target.checked)} disabled={Boolean(localScreenTrack)} /></label>
          {shareAudio && !localScreenTrack && <p className="audio-capture-hint">Na janela de compartilhamento, escolha uma aba com áudio ou marque “Compartilhar também o áudio do sistema”. Janelas isoladas geralmente não fornecem som.</p>}
          {localScreenTrack && <div className={`audio-publish-status ${publishedAudio ? "active" : "missing"}`}><span>{publishedAudio ? "●" : "!"}</span><div><strong>{publishedAudio ? "Áudio sendo transmitido" : "A fonte não forneceu áudio"}</strong><small>{publishedAudio ? "Os demais participantes recebem uma faixa estéreo separada." : "Pare a tela e compartilhe novamente escolhendo uma aba ou tela com a opção de áudio marcada."}</small></div></div>}
          {streamStats && <div className="quality-live"><span className="status-dot" /><div><strong>Qualidade efetiva</strong><small>{streamStats.width}×{streamStats.height} · {streamStats.fps} FPS · {streamStats.bitrate.toFixed(1)} Mbps{streamStats.limitation && streamStats.limitation !== "none" ? ` · limite: ${streamStats.limitation}` : ""}</small></div></div>}
          <div className="participants-heading"><span>Participantes</span><strong>{participants.length}/{roomLimit}</strong></div>
          <div className="participants-list">{participants.map((participant) => <div className="participant-box" key={participant.identity}><div><span className="avatar">{participant.name[0]?.toUpperCase() || "?"}</span><span><strong>{participant.name}</strong><small>{participant.sharing ? "Compartilhando tela" : "Na sala"}</small></span></div><span className={participant.sharing ? "sharing-label" : "you-label"}>{participant.local ? "você" : participant.sharing ? "ao vivo" : "online"}</span></div>)}</div>
        </aside>
      </section>
      <footer className="footer"><span>LiveKit · sem gravação automática</span><span>{participants.length} de {roomLimit} participantes</span></footer>
    </main>
  );
}
