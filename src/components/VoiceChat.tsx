import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice chat — P2P WebRTC audio with two signaling paths:
 *
 * 1. Socket.IO (primary): the app's own signaling server
 *    (VITE_VOICE_SIGNALING_URL or same-origin).
 * 2. Trystero (fallback): fully free, serverless signaling over public
 *    Nostr relays. Kicks in automatically when the Socket.IO server is
 *    unreachable, so study-room voice keeps working with zero infrastructure.
 *    Audio itself is always peer-to-peer WebRTC in both modes.
 *
 * Optional TURN (Metered Open Relay, free 20 GB/month) is injected via env:
 *   VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
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

type SignalingMode = 'socket' | 'p2p';

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
  // Surface which signaling path is live so the UI can reassure the user.
  const [signalingMode, setSignalingMode] = useState<SignalingMode>('socket');

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidates = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const remoteAudiosRef = useRef<Record<string, HTMLAudioElement>>({});
  const socketRef = useRef<unknown | null>(null);
  const modeRef = useRef<SignalingMode>('socket');
  const trysteroRoomRef = useRef<{ leave: () => void; addStream: (s: MediaStream, o?: any) => Promise<void[]>; removeStream: (s: MediaStream, o?: any) => void } | null>(null);
  const deafenedRef = useRef(false);

  const attachRemoteAudio = useCallback((peerId: string, stream: MediaStream) => {
    let audioEl = remoteAudiosRef.current[peerId];
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.setAttribute('playsinline', 'true');
      remoteAudiosRef.current[peerId] = audioEl;
    }
    audioEl.srcObject = stream;
    audioEl.muted = deafenedRef.current;
    audioEl.play().catch(() => {});
  }, []);

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

    // Leave the Trystero room if the P2P fallback was active
    if (trysteroRoomRef.current) {
      try { trysteroRoomRef.current.leave(); } catch {}
      trysteroRoomRef.current = null;
    }
    modeRef.current = 'socket';
    setSignalingMode('socket');
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
        if (event.candidate && modeRef.current === 'socket') {
          (socketRef.current as any)?.emit?.('voice:signal', {
            roomId,
            senderPlayerId: myPlayerId,
            targetPlayerId,
            signal: { candidate: event.candidate.toJSON() },
          });
        }
      };

      pc.ontrack = (event) => {
        attachRemoteAudio(targetPlayerId, event.streams[0]);
      };

      peerConnections.current[targetPlayerId] = pc;
      return pc;
    },
    [attachRemoteAudio, myPlayerId, roomId],
  );

  const ensureLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current;
    setMicError(null);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setMicError('Audio devices not supported in this browser.');
        return null;
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
      return stream;
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError('Mic blocked. Click to retry.');
      } else {
        setMicError('Mic unavailable. Click to retry.');
      }
      return null;
    }
  }, []);

  const startVoiceSession = useCallback(async () => {
    if (modeRef.current !== 'socket') return;
    const stream = await ensureLocalStream();
    if (!stream) return;

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
  }, [createPeerConnection, ensureLocalStream, myPlayerId, peerIds, roomId]);

  // ── P2P fallback (Trystero over Nostr relays — free, serverless) ──────────
  const startP2PFallback = useCallback(async () => {
    if (trysteroRoomRef.current) return;
    modeRef.current = 'p2p';
    setSignalingMode('p2p');

    const stream = await ensureLocalStream();
    if (!stream) return;

    try {
      const nostrModule = await import('trystero/nostr');
      const joinRoom = (nostrModule as any).joinRoom;
      const room = joinRoom(
        {
          appId: 'studyworks-voice',
          rtcConfig: { iceServers: buildIceServers() },
        },
        `voice-${roomId}`,
      );
      trysteroRoomRef.current = room;

      room.onPeerJoin((peerId: string) => {
        // Announce presence to StudyRoom (uses trystero's peer id, which is
        // not the logged-in user id — the UI shows it as a voice participant).
        window.dispatchEvent(new CustomEvent('voice:peer_joined', { detail: { playerId: peerId } }));
        room.addStream(stream, { target: peerId }).catch(() => {});
      });

      room.onPeerLeave((peerId: string) => {
        window.dispatchEvent(new CustomEvent('voice:peer_left', { detail: { playerId: peerId } }));
        const audio = remoteAudiosRef.current[peerId];
        if (audio) {
          try { audio.pause(); audio.srcObject = null; } catch {}
          delete remoteAudiosRef.current[peerId];
        }
      });

      room.onPeerStream((remoteStream: MediaStream, peerId: string) => {
        attachRemoteAudio(peerId, remoteStream);
        window.dispatchEvent(new CustomEvent('voice:peer_joined', { detail: { playerId: peerId } }));
      });

      console.info('[VoiceChat] Using free P2P signaling (Trystero/Nostr) — voice server unreachable.');
    } catch (e) {
      console.warn('[VoiceChat] P2P fallback failed:', e);
      setMicError('Voice unavailable: signaling and P2P fallback both failed.');
    }
  }, [attachRemoteAudio, ensureLocalStream, roomId]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
    if (modeRef.current === 'socket') {
      (socketRef.current as any)?.emit?.('voice:state', {
        roomId,
        isMuted: nextMuted,
        isDeafened,
      });
    }
  }, [isDeafened, isMuted, roomId]);

  const toggleDeafen = useCallback(() => {
    const nextDeafened = !isDeafened;
    setIsDeafened(nextDeafened);
    deafenedRef.current = nextDeafened;
    Object.values(remoteAudiosRef.current).forEach((audio) => {
      if (audio) audio.muted = nextDeafened;
    });
    if (nextDeafened) {
      setIsMuted(true);
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
    }
    if (modeRef.current === 'socket') {
      (socketRef.current as any)?.emit?.('voice:state', {
        roomId,
        isMuted: nextDeafened ? true : isMuted,
        isDeafened: nextDeafened,
      });
    }
  }, [isDeafened, isMuted, roomId]);

  useEffect(() => {
    if (!isVoiceActive) {
      cleanupVoice();
      return;
    }

    let socket: unknown = null;
    let cancelled = false;
    let connectTimeout: ReturnType<typeof setTimeout> | undefined;
    let socketConnected = false;

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
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 3000,
        });
        socketRef.current = socket;

        (socket as any).on('connect', () => {
          if (cancelled) return;
          socketConnected = true;
          if (connectTimeout) clearTimeout(connectTimeout);
          modeRef.current = 'socket';
          setSignalingMode('socket');
          setMicError(null);
          (socket as any).emit('voice:join', { playerId: myPlayerId, roomId });
          startVoiceSession().catch(() => {});
          // Notify StudyRoom that the local user has joined so it can show them
          window.dispatchEvent(new CustomEvent('voice:peer_joined', { detail: { playerId: myPlayerId } }));
        });

        (socket as any).on('voice:signal', async ({ senderPlayerId, signal }: any) => {
          if (cancelled || modeRef.current !== 'socket') return;
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

        // Signaling server unreachable → fall back to free serverless
        // signaling (Trystero) so voice still works.
        (socket as any).on('connect_error', () => {
          if (cancelled || socketConnected) return;
          setMicError(null);
          startP2PFallback();
        });

        // Also guard against silent hangs: if we never connect within 6s,
        // switch to the P2P fallback.
        connectTimeout = setTimeout(() => {
          if (!cancelled && !socketConnected && !trysteroRoomRef.current) {
            startP2PFallback();
          }
        }, 6000);

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
        if (!cancelled) startP2PFallback();
      }
    };

    init();

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    window.addEventListener('click', unlockAudio);

    return () => {
      cancelled = true;
      if (connectTimeout) clearTimeout(connectTimeout);
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
    // startVoiceSession / startP2PFallback are stable per (peerIds, roomId)
  }, [cleanupVoice, createPeerConnection, isVoiceActive, myPlayerId, roomId, signalingUrl, startP2PFallback, startVoiceSession]);

  // When new peers appear in socket mode, call them.
  useEffect(() => {
    if (!isVoiceActive || modeRef.current !== 'socket' || !localStreamRef.current) return;

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
  }, [peerIds.join(','), createPeerConnection, isVoiceActive, myPlayerId, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          onClick={() => {
            if (modeRef.current === 'socket') startVoiceSession();
            else { cleanupVoice(); startP2PFallback(); }
          }}
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
          <span
            className="text-xs text-muted"
            title={signalingMode === 'p2p'
              ? 'Connected via free peer-to-peer signaling (no voice server needed)'
              : 'Connected via the voice signaling server'}
            style={{ fontSize: '0.7rem', userSelect: 'none' }}
          >
            {signalingMode === 'p2p' ? '🌐 P2P' : '☁️ Live'}
          </span>
        </>
      )}
    </div>
  );
}
