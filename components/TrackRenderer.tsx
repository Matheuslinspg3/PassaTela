"use client";

import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

export function TrackRenderer({ track, audio = false }: { track: Track; audio?: boolean }) {
  const elementRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return audio ? <audio ref={elementRef} autoPlay /> : <video ref={elementRef} autoPlay playsInline className="remote-video" />;
}
