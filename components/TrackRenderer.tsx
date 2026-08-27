"use client";

import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

type TrackRendererProps = {
  track: Track;
  audio?: boolean;
  muted?: boolean;
  className?: string;
};

export function TrackRenderer({ track, audio = false, muted = false, className = "remote-video" }: TrackRendererProps) {
  const elementRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return audio
    ? <audio ref={elementRef} autoPlay muted={muted} />
    : <video ref={elementRef} autoPlay playsInline muted={muted} className={className} data-pip-video />;
}
