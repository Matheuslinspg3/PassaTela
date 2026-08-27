"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { TrackRenderer } from "../components/TrackRenderer";

type Preset = { id: string; name: string; description: string; resolution: string; width: number; height: number; fps: number; bitrate: number; hint: "detail" | "motion" };
const PRESETS: Preset[] = [
  { id: "low", name: "Baixa latência", description: "Mais estabilidade com menor consumo", resolution: "1280 × 720", width: 1280, height: 720, fps: 30, bitrate: 3, hint: "detail" },
  { id: "balanced", name: "Equilibrada", description: "A escolha certa para a maioria das situações", resolution: "1920 × 1080", width: 1920, height: 1080, fps: 30, bitrate: 6, hint: "detail" },
  { id: "high", name: "Alta qualidade", description: "Imagem nítida e movimento fluido", resolution: "2560 × 1440", width: 2560, height: 1440, fps: 60, bitrate: 16, hint: "motion" },
  { id: "ultra", name: "Ultra", description: "Máxima definição, quando o dispositivo suportar", resolution: "3840 × 2160", width: 3840, height: 2160, fps: 60, bitrate: 32, hint: "motion" },
];

function roomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

export default function Home() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState("balanced");
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("desconectado");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remoteTracks, setRemoteTracks] = useState<Array<{ id: string; track: RemoteTrack; name: string }>>([]);
  const livekit = useRef<Room | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const preset = useMemo(() => PRESETS.find((item) => item.id === presetId) ?? PRESETS[1], [presetId]);

  useEffect(() => () => { livekit.current?.disconnect(); }, []);

  async function connect(target: string, username: string) {
    setError(""); setStatus("conectando");
    try {
      const response = await fetch("/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: target, username }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao entrar na sala.");
      const currentRoom = new Room({ adaptiveStream: true, dynacast: true });
      currentRoom.on(RoomEvent.ConnectionStateChanged, (state) => setStatus(state.toLowerCase()));
      currentRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio || track.kind === Track.Kind.Video) {
          setRemoteTracks((current) => [...current.filter((item) => item.id !== publication.trackSid), { id: publication.trackSid, track, name: participant.name || participant.identity }]);
        }
      });
      currentRoom.on(RoomEvent.TrackUnsubscribed, (_track, publication) => setRemoteTracks((current) => current.filter((item) => item.id !== publication.trackSid)));
      await currentRoom.connect(data.url, data.token);
      livekit.current = currentRoom; setStatus("conectado"); setRoomId(target);
    } catch (cause) { setStatus("desconectado"); setError(cause instanceof Error ? cause.message : "Não foi possível conectar à sala."); }
  }

  function enter(target: string) {
    const username = name.trim(); const targetRoom = target.trim().toUpperCase();
    if (username.length < 2) return setError("Digite um nome com pelo menos 2 caracteres.");
    if (targetRoom.length < 4) return setError("Digite um código de sala válido.");
    sessionStorage.setItem("passatela-name", username); void connect(targetRoom, username);
  }

  async function toggleScreen() {
    const currentRoom = livekit.current;
    if (!currentRoom) return setError("A sala ainda está conectando.");
    if (sharing) {
      await currentRoom.localParticipant.setScreenShareEnabled(false);
      if (localVideo.current) localVideo.current.srcObject = null;
      setSharing(false); setNotice(""); return;
    }
    try {
      const publication = await currentRoom.localParticipant.setScreenShareEnabled(true, { audio: false, video: true, resolution: { width: preset.width, height: preset.height, frameRate: preset.fps }, contentHint: preset.hint, selfBrowserSurface: "exclude", surfaceSwitching: "include" }, { source: Track.Source.ScreenShare, screenShareEncoding: { maxBitrate: preset.bitrate * 1_000_000, maxFramerate: preset.fps } });
      if (publication?.track && localVideo.current) publication.track.attach(localVideo.current);
      setSharing(true); setNotice(`Transmitindo para a sala em ${preset.resolution} · até ${preset.fps} FPS.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A captura foi cancelada."); }
  }

  function leave() { void livekit.current?.localParticipant.setScreenShareEnabled(false); livekit.current?.disconnect(); livekit.current = null; setRemoteTracks([]); setRoomId(null); setSharing(false); setStatus("desconectado"); }

  if (!roomId) return <main className="shell landing-shell"><nav className="topbar"><div className="brand"><span className="brand-mark">↗</span><span>PassaTela</span></div><span className="topbar-note"><span className="status-dot" /> simples · rápido · privado</span></nav><section className="hero-grid"><div className="hero-copy"><p className="eyebrow">COMPARTILHAMENTO SEM COMPLICAÇÃO</p><h1>Sua tela.<br /><em>Do seu jeito.</em></h1><p className="hero-description">Uma sala leve para compartilhar tela, áudio e câmera com qualidade. Sem cadastro e sem distrações.</p><div className="mini-features"><span>◉ Baixa latência</span><span>◉ Sem gravação automática</span><span>◉ Controle simples</span></div></div><div className="join-card"><div className="card-kicker">COMECE AGORA</div><h2>Entre em uma sala</h2><p className="muted">Use um nome temporário para continuar.</p><label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Como quer ser chamado?" maxLength={32} /></label><label>Código da sala<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ex.: A7K2Q9" maxLength={12} /></label>{error && <p className="feedback error">{error}</p>}<button className="button primary" onClick={() => enter(code)}>Entrar na sala <span>→</span></button><div className="divider"><span>ou</span></div><button className="button secondary" onClick={() => enter(roomCode())}>Criar uma nova sala <span>＋</span></button><p className="privacy-note">Seu nome não precisa de conta e fica apenas nesta sessão.</p></div></section><footer className="footer"><span>PassaTela © 2026</span><span>Transmissão privada por padrão</span></footer></main>;

  return <main className="shell room-shell"><nav className="topbar room-topbar"><div className="brand"><span className="brand-mark">↗</span><span>PassaTela</span></div><div className="room-meta"><span className="live-pill"><span className="status-dot" /> {status}</span><span className="room-code">{roomId}</span><button className="icon-button" title="Copiar código" onClick={() => navigator.clipboard?.writeText(roomId)}>⧉</button></div></nav><section className="room-layout"><div className="stage-column"><div className="stage-header"><div><p className="eyebrow">SALA {roomId}</p><h1>{remoteTracks.length ? "Transmissões na sala" : "Pronto para compartilhar"}</h1></div><span className="connection"><span className="status-dot" /> {status}</span></div><div className={`stage ${sharing || remoteTracks.length ? "stage-sharing" : ""}`}>{sharing && <video ref={localVideo} className="screen-video local-screen" muted playsInline />}{!sharing && remoteTracks.length === 0 && <div className="empty-stage"><div className="screen-icon">▣</div><h2>Sua tela aparecerá aqui</h2><p>Escolha um preset e comece o compartilhamento.</p></div>}{remoteTracks.length > 0 && <div className={`remote-grid ${sharing ? "with-local" : ""}`}>{remoteTracks.map((item) => <div className="remote-tile" key={item.id}><TrackRenderer track={item.track} /><span className="tile-label">{item.name}</span></div>)}</div>}<div className="stage-label">{sharing ? <><span className="record-dot" /> transmitindo · {preset.resolution}</> : remoteTracks.length ? "transmissões recebidas" : "nenhuma transmissão ativa"}</div></div>{notice && <p className="feedback success">{notice}</p>}{error && <p className="feedback error">{error}</p>}<div className="room-actions"><button className="button primary large" onClick={toggleScreen}>{sharing ? "Parar compartilhamento" : "Compartilhar minha tela"} <span>{sharing ? "■" : "↗"}</span></button><button className="button secondary large" onClick={leave}>Sair da sala</button></div></div><aside className="settings-panel"><div className="panel-heading"><div><p className="eyebrow">CONFIGURAÇÃO</p><h2>Qualidade</h2></div><span className="sliders">☷</span></div><p className="muted panel-intro">Defina como sua tela será capturada antes de compartilhar.</p><div className="preset-list">{PRESETS.map((item) => <button key={item.id} className={`preset ${presetId === item.id ? "selected" : ""}`} onClick={() => setPresetId(item.id)}><span className="radio">{presetId === item.id ? "●" : "○"}</span><span className="preset-text"><strong>{item.name}</strong><small>{item.description}</small><span className="preset-spec">{item.resolution} · {item.fps} FPS · {item.bitrate} Mbps</span></span></button>)}</div><div className="tip"><span>✦</span><p><strong>Sobre 1440p/60</strong><br />Disponível quando seu computador, navegador e internet suportarem. O sistema ajustará a qualidade se necessário.</p></div><div className="participant-box"><div><span className="avatar">{(name.trim()[0] || "V").toUpperCase()}</span><span>{name.trim() || "Você"}</span></div><span className="you-label">você</span></div></aside></section><footer className="footer"><span>LiveKit · sem gravação automática</span><span>{remoteTracks.length + 1} participante{remoteTracks.length ? "s" : ""}</span></footer></main>;
}
