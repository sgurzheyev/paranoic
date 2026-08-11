import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CallState, P2PHandlers, P2PStatus, SignalingDebugStatus } from './p2p';
import {
  destroyP2PSession,
  ensureP2PSession,
  getP2PSession,
  hasLiveP2PSession,
} from './p2pSession';

type P2PContextValue = {
  status: P2PStatus;
  callState: CallState;
  signalingStatus: SignalingDebugStatus | '';
  ensure: (handlers: P2PHandlers) => ReturnType<typeof ensureP2PSession>;
  get: typeof getP2PSession;
  /** Только явный Hang Up / смена peer / бан. */
  hangUpSession: () => void;
  isLive: () => boolean;
  setStatus: (s: P2PStatus) => void;
  setCallState: (s: CallState) => void;
  setSignalingStatus: (s: SignalingDebugStatus | '') => void;
};

const P2PContext = createContext<P2PContextValue | null>(null);

/**
 * Держит зеркало статуса UI. Сам RTCPeerConnection живёт в p2pSession (module singleton)
 * и не уничтожается при размонтировании экранов.
 */
export function P2PProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<P2PStatus>('idle');
  const [callState, setCallState] = useState<CallState>('idle');
  const [signalingStatus, setSignalingStatus] = useState<SignalingDebugStatus | ''>(
    ''
  );

  const hangUpSession = useCallback(() => {
    destroyP2PSession();
    setStatus('disconnected');
    setCallState('idle');
    setSignalingStatus('');
  }, []);

  const ensure = useCallback((handlers: P2PHandlers) => {
    return ensureP2PSession(handlers);
  }, []);

  const value = useMemo<P2PContextValue>(
    () => ({
      status,
      callState,
      signalingStatus,
      ensure,
      get: getP2PSession,
      hangUpSession,
      isLive: hasLiveP2PSession,
      setStatus,
      setCallState,
      setSignalingStatus,
    }),
    [status, callState, signalingStatus, ensure, hangUpSession]
  );

  return <P2PContext.Provider value={value}>{children}</P2PContext.Provider>;
}

export function useP2P(): P2PContextValue {
  const ctx = useContext(P2PContext);
  if (!ctx) {
    throw new Error('useP2P must be used within P2PProvider');
  }
  return ctx;
}

/** Опциональный доступ (для кода вне дерева — редко). */
export function useP2POptional(): P2PContextValue | null {
  return useContext(P2PContext);
}
