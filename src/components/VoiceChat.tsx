import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Build the ICE server list at runtime so TURN credentials can be injected
 * via env vars without being hardcoded in the bundle.
 *
 * Required Vercel env vars (set in project → Settings → Environment Variables):
 *   VITE_TURN_USERNAME   — Metered username  (from dashboard.metered.ca)
 *   VITE_TURN_CREDENTIAL — Metered credential (from dashboard.metered.ca)
 *
 * Without these the app still works for users on home/mobile networks (STUN
 * only). TURN is only needed for symmetric-NAT environments (corporate Wi-Fi,
 * some mobile carriers).
 */
function buildIceServers(): RTCIceServer[] {
  const base: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Metered Open Relay free STUN — no credentials needed
    { urls: 'stun:standard.relay.metered.ca:80' },
  ];

  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

  if (username && credential) {
    // Metered Open Relay TURN servers (free tier: 20 GB/month)
    // https://www.metered.ca/tools/openrelay/
    base.push(
      { urls: 'turn:standard.relay.metered.ca:80',  username, credential },
      { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username, credential },
      { urls: 'turn:standard.relay.metered.ca:443', username, credential },
      { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username, credential },
    );
  }

  return base;
}

export interface VoiceChatProps {
  signalingUrl: string;
  roomId: string;
  myPlayerId: string;
  peerIds: string[];
  isVoiceActive?: boolean;
}

export default function VoiceChat({
  signalingUrl,
  roomId,
  myPlayerId,
  peerIds,
  isVoiceActive = true,
}: VoiceChatProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidates = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const remoteAudiosRef = useRef<Record<string, HTMLAudioElement>>({});
  const socketRef = useRef<unknown | null>(null);

  const cleanupVoice = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    Object.values(peerConnections.current).forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    peerConnections.current = {};
    pendingCandidates.current = {};

    Object.values(remoteAudiosRef.current).forEach((a) => {
      try {
        a.pause();
        a.srcObject = null;
      } catch {}
    });
    remoteAudiosRef.current = {};
  }, []);

  const createPeerConnection = useCallback(
    (targetPlayerId: string): RTCPeerConnection => {
      if (peerConnections.current[targetPlayerId]) {
        return peerConnections.current[targetPlayerId];
      }

      const pc = new RTCPeerConnection({ iceServers: buildIceServers() });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          (socketRef.current as any)?.emit?.('voice:signal', {
            roomId,
            senderPlayerId: myPlayerId,
            targetPlayerId,
            signal: { candidate: event.candidate.toJSON() },
          });
        }
      };

      pc.ontrack = (event) => {
        let audioEl = remoteAudiosRef.current[targetPlayerId];
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          audioEl.setAttribute('playsinline', 'true');
          remoteAudiosRef.current[targetPlayerId] = audioEl;
        }
        audioEl.srcObject = event.streams[0];
        audioEl.muted = isDeafened;
        audioEl.play().catch(() => {});
      };

      peerConnections.current[targetPlayerId] = pc;
      return pc;
    },
    [isDeafened, myPlayerId, roomId],
  );

  const startVoiceSession = useCallback(async () => {
    setMicError(null);
    try {
      if (localStreamRef.current) {
        return;
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        setMicError('Audio devices not supported in this browser.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;

      for (const targetId of peerIds) {
        if (!targetId || targetId === myPlayerId) continue;
        const pc = createPeerConnection(targetId);
        const isInitiator = myPlayerId < targetId;
        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          (socketRef.current as any)?.emit?.('voice:signal', {
            roomId,
            senderPlayerId: myPlayerId,
            targetPlayerId: targetId,
            signal: { sdp: pc.localDescription },
          });
        }
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError('Mic blocked. Click to retry.');
      } else {
        setMicError('Mic unavailable. Click to retry.');
      }
    }
  }, [createPeerConnection, myPlayerId, peerIds, roomId]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
    (socketRef.current as any)?.emit?.('voice:state', {
      roomId,
      isMuted: nextMuted,
      isDeafened,
    });
  }, [isDeafened, isMuted, roomId]);

  const toggleDeafen = useCallback(() => {
    const nextDeafened = !isDeafened;
    setIsDeafened(nextDeafened);
    Object.values(remoteAudiosRef.current).forEach((audio) => {
      if (audio) audio.muted = nextDeafened;
    });
    if (nextDeafened) {
      setIsMuted(true);
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
    }
    (socketRef.current as any)?.emit?.('voice:state', {
      roomId,
      isMuted: nextDeafened ? true : isMuted,
      isDeafened: nextDeafened,
    });
  }, [isDeafened, isMuted, roomId]);

  useEffect(() => {
    if (!isVoiceActive) {
      cleanupVoice();
      return;
    }

    let socket: unknown = null;
    let cancelled = false;

    const unlockAudio = () => {
      Object.values(remoteAudiosRef.current).forEach((audio) => {
        if (audio && audio.paused && !audio.muted) {
          audio.play().catch(() => {});
        }
      });
    };

    const init = async () => {
      try {
        const mod = await import('socket.io-client');
        const ioClient = mod.io || mod.default || mod;
        socket = ioClient(signalingUrl, {
          // Must match the server's Socket.IO mount path. The default
          // ('/socket.io/') is intercepted by the HTTP handler and never
          // reaches the signaling server.
          path: '/socket.io/voice',
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
        });
        socketRef.current = socket;

        (socket as any).on('connect', () => {
          (socket as any).emit('voice:join', { playerId: myPlayerId, roomId });
          startVoiceSession().catch(() => {});
          // Notify StudyRoom that the local user has joined so it can show them
          window.dispatchEvent(new CustomEvent('voice:peer_joined', { detail: { playerId: myPlayerId } }));
        });

        (socket as any).on('voice:signal', async ({ senderPlayerId, signal }: any) => {
          if (cancelled) return;
          try {
            let pc = peerConnections.current[senderPlayerId];
            if (!pc) {
              pc = createPeerConnection(senderPlayerId);
              // New remote peer appeared — tell StudyRoom
              window.dispatchEvent(new CustomEvent('voice:peer_joined', { detail: { playerId: senderPlayerId } }));
            }

            if (signal.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

              const queued = pendingCandidates.current[senderPlayerId] || [];
              for (const cand of queued) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (err) {
                  console.warn('ICE drain error:', err);
                }
              }
              pendingCandidates.current[senderPlayerId] = [];

              if (signal.sdp.type === 'offer') {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                (socket as any).emit('voice:signal', {
                  roomId,
                  senderPlayerId: myPlayerId,
                  targetPlayerId: senderPlayerId,
                  signal: { sdp: pc.localDescription },
                });
              }
            } else if (signal.candidate) {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
              } else {
                pendingCandidates.current[senderPlayerId] = [
                  ...(pendingCandidates.current[senderPlayerId] || []),
                  signal.candidate,
                ];
              }
            }
          } catch (err) {
            console.warn('WebRTC signal processing notice:', err);
          }
        });

        (socket as any).on('connect_error', () => {
          if (!cancelled) setMicError('Voice signaling unreachable.');
        });

        // Relay peer mute/deafen state changes to StudyRoom
        (socket as any).on('voice:state_change', ({ playerId, isMuted, isDeafened }: any) => {
          if (cancelled) return;
          window.dispatchEvent(new CustomEvent('voice:peer_state', { detail: { playerId, isMuted, isDeafened } }));
        });

        // Relay peer disconnection to StudyRoom
        (socket as any).on('voice:peer_left', ({ playerId }: any) => {
          if (cancelled) return;
          window.dispatchEvent(new CustomEvent('voice:peer_left', { detail: { playerId } }));
        });
      } catch (e) {
        if (!cancelled) setMicError('Voice chat unavailable in this environment.');
      }
    };

    init();

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    window.addEventListener('click', unlockAudio);

    return () => {
      cancelled = true;
      // Tell StudyRoom this client is leaving
      window.dispatchEvent(new CustomEvent('voice:peer_left', { detail: { playerId: myPlayerId } }));
      cleanupVoice();
      if (socket) {
        try {
          (socket as any).disconnect?.();
        } catch {}
      }
      socketRef.current = null;
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('click', unlockAudio);
    };
  }, [cleanupVoice, createPeerConnection, isVoiceActive, myPlayerId, peerIds, roomId, signalingUrl, startVoiceSession]);

  useEffect(() => {
    if (!isVoiceActive || !localStreamRef.current || !socketRef.current) return;

    peerIds.forEach(async (targetId) => {
      if (!targetId || targetId === myPlayerId || peerConnections.current[targetId]) return;
      const pc = createPeerConnection(targetId);
      const isInitiator = myPlayerId < targetId;
      if (isInitiator) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          (socketRef.current as any)?.emit?.('voice:signal', {
            roomId,
            senderPlayerId: myPlayerId,
            targetPlayerId: targetId,
            signal: { sdp: pc.localDescription },
          });
        } catch (e) {
          console.warn('Failed to send offer:', e);
        }
      }
    });
  }, [peerIds.join(','), createPeerConnection, isVoiceActive, myPlayerId, roomId]);

  if (!isVoiceActive) return null;

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.35rem 0.6rem',
      borderRadius: '9999px',
      border: '1px solid var(--border)',
      background: 'var(--surface-1)',
    }}>
      {micError ? (
        <button
          onClick={startVoiceSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.35rem 0.7rem',
            borderRadius: '9999px',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          title={micError}
        >
          <span style={{ fontSize: '0.8rem' }}>🎙️</span>
          <span>Enable Mic</span>
        </button>
      ) : (
        <>
          <button
            onClick={toggleMute}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2rem',
              height: '2rem',
              borderRadius: '9999px',
              border: '1px solid transparent',
              background: isMuted ? 'var(--danger-soft)' : 'var(--surface-2)',
              color: isMuted ? 'var(--danger)' : 'var(--text)',
              cursor: 'pointer',
            }}
            title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isMuted ? <span>🔇</span> : <span>🎙️</span>}
          </button>
          <button
            onClick={toggleDeafen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2rem',
              height: '2rem',
              borderRadius: '9999px',
              border: '1px solid transparent',
              background: isDeafened ? 'var(--danger-soft)' : 'var(--surface-2)',
              color: isDeafened ? 'var(--danger)' : 'var(--text)',
              cursor: 'pointer',
            }}
            title={isDeafened ? 'Undeafen Audio' : 'Deafen Audio'}
          >
            {isDeafened ? <span>🔕</span> : <span>🔔</span>}
          </button>
        </>
      )}
    </div>
  );
}
