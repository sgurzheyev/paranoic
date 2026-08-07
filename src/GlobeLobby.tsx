import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, Sparkles, X } from 'lucide-react';

type GlobeLobbyProps = {
  onBack: () => void;
  onCreateConnection: () => void;
};

type NetworkNode = {
  id: string;
  position: [number, number, number];
  invite?: boolean;
  label?: string;
};

const SPHERE_RADIUS = 8;
const NODE_COUNT = 42;
const INVITE_ID = 'invite-family';

function fibonacciSphere(count: number, radius: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push([Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius]);
  }
  return points;
}

function buildNetwork(): { nodes: NetworkNode[]; links: [number, number][] } {
  const points = fibonacciSphere(NODE_COUNT, SPHERE_RADIUS);
  const inviteIndex = Math.floor(NODE_COUNT * 0.62);
  const nodes: NetworkNode[] = points.map((position, i) => ({
    id: i === inviteIndex ? INVITE_ID : `n-${i}`,
    position,
    invite: i === inviteIndex,
    label: i === inviteIndex ? 'Инвайт от близкого' : undefined,
  }));

  const links: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = new THREE.Vector3(...nodes[i].position);
    const nearest: { j: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const d = a.distanceTo(new THREE.Vector3(...nodes[j].position));
      nearest.push({ j, d });
    }
    nearest.sort((x, y) => x.d - y.d);
    for (const n of nearest.slice(0, 2)) {
      const key: [number, number] = i < n.j ? [i, n.j] : [n.j, i];
      if (!links.some(([x, y]) => x === key[0] && y === key[1])) {
        links.push(key);
      }
    }
  }
  return { nodes, links };
}

function LookAroundControls({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree();
  const yaw = useRef(0.35);
  const pitch = useRef(-0.12);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useMemo(() => {
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 0, 0);
  }, [camera]);

  useFrame(() => {
    if (!enabled) return;
    camera.position.set(0, 0, 0);
    camera.rotation.y = yaw.current;
    camera.rotation.x = pitch.current;
  });

  useMemo(() => {
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (!enabled) return;
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!enabled || !dragging.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      yaw.current -= dx * 0.005;
      pitch.current -= dy * 0.004;
      pitch.current = Math.max(-1.2, Math.min(1.2, pitch.current));
    };
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onUp);
    };
  }, [enabled, gl]);

  return null;
}

function CameraFlyTo({
  target,
  active,
}: {
  target: [number, number, number] | null;
  active: boolean;
}) {
  const { camera } = useThree();
  const progress = useRef(0);
  const startPos = useRef(new THREE.Vector3());
  const startQuat = useRef(new THREE.Quaternion());

  useFrame((_, dt) => {
    if (!active || !target) {
      progress.current = 0;
      return;
    }
    if (progress.current === 0) {
      startPos.current.copy(camera.position);
      startQuat.current.copy(camera.quaternion);
    }
    progress.current = Math.min(1, progress.current + dt * 0.85);
    const t = 1 - (1 - progress.current) ** 3;
    const dest = new THREE.Vector3(...target).multiplyScalar(0.55);
    camera.position.lerpVectors(startPos.current, dest, t);

    const look = new THREE.Vector3(...target);
    const m = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0));
    const endQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    camera.quaternion.slerpQuaternions(startQuat.current, endQuat, t);
  });

  return null;
}

function DimNode({
  position,
  onHover,
}: {
  position: [number, number, number];
  onHover: (h: boolean) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);

  return (
    <mesh
      ref={ref}
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
    >
      <sphereGeometry args={[0.09, 12, 12]} />
      <meshBasicMaterial color="#64748b" transparent opacity={0.45} />
    </mesh>
  );
}

function InviteNode({
  position,
  label,
  selected,
  onSelect,
  onHover,
}: {
  position: [number, number, number];
  label: string;
  selected: boolean;
  onSelect: () => void;
  onHover: (h: boolean) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const hovered = useRef(false);

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.12;
    const boost = hovered.current || selected ? 1.25 : 1;
    if (meshRef.current) meshRef.current.scale.setScalar(pulse * boost);
    if (glowRef.current) {
      glowRef.current.scale.setScalar(pulse * boost * 2.2);
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 + Math.sin(clock.elapsedTime * 2.4) * 0.08;
    }
  });

  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hovered.current = true;
    onHover(true);
    document.body.style.cursor = 'pointer';
  };
  const handleOut = () => {
    hovered.current = false;
    onHover(false);
    document.body.style.cursor = 'default';
  };

  return (
    <group position={position}>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      >
        <sphereGeometry args={[0.2, 20, 20]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#f59e0b"
          emissiveIntensity={1.4}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>
      <pointLight color="#fbbf24" intensity={1.6} distance={4} />
      <Html center distanceFactor={10} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-full border border-amber-300/40 bg-black/55 px-3 py-1 text-xs font-bold text-amber-100 shadow-lg backdrop-blur-sm">
          {label}
        </div>
      </Html>
    </group>
  );
}

function NetworkScene({
  onInviteSelect,
  flying,
}: {
  onInviteSelect: (pos: [number, number, number]) => void;
  flying: boolean;
}) {
  const { nodes, links } = useMemo(() => buildNetwork(), []);
  const [, setHoverDim] = useState(false);

  return (
    <>
      <color attach="background" args={['#03050a']} />
      <ambientLight intensity={0.35} />
      <LookAroundControls enabled={!flying} />

      {links.map(([a, b]) => (
        <Line
          key={`${a}-${b}`}
          points={[nodes[a].position, nodes[b].position]}
          color="#334155"
          lineWidth={1}
          transparent
          opacity={0.35}
        />
      ))}

      {nodes.map((node) =>
        node.invite ? (
          <InviteNode
            key={node.id}
            position={node.position}
            label={node.label || 'Инвайт от близкого'}
            selected={flying}
            onSelect={() => onInviteSelect(node.position)}
            onHover={() => undefined}
          />
        ) : (
          <DimNode key={node.id} position={node.position} onHover={setHoverDim} />
        )
      )}
    </>
  );
}

export default function GlobeLobby({ onBack, onCreateConnection }: GlobeLobbyProps) {
  const [selectedPos, setSelectedPos] = useState<[number, number, number] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const flying = modalOpen && selectedPos !== null;

  return (
    <div className="relative h-svh w-full overflow-hidden bg-[#03050a] font-[Nunito,system-ui,sans-serif] text-slate-200">
      <Canvas
        camera={{ position: [0, 0, 0], fov: 75, near: 0.05, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ camera }) => {
          camera.rotation.order = 'YXZ';
          camera.position.set(0, 0, 0);
        }}
        className="absolute inset-0 touch-none"
      >
        <Suspense fallback={null}>
          <NetworkScene
            flying={flying}
            onInviteSelect={(pos) => {
              setSelectedPos(pos);
              setModalOpen(true);
            }}
          />
          <CameraFlyTo target={selectedPos} active={flying} />
        </Suspense>
      </Canvas>

      {/* UI overlay */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <header className="pointer-events-auto flex items-center justify-between px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm font-bold text-slate-100 backdrop-blur-md transition hover:bg-black/55"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          <div className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm font-bold text-slate-200 backdrop-blur-md">
            Family Mode
          </div>
        </header>

        <div className="pointer-events-none mt-2 px-4 text-center sm:px-6">
          <p className="mx-auto max-w-md text-sm text-slate-400 sm:text-base">
            Вы в центре сети. Поверните взгляд и найдите яркое приглашение.
          </p>
        </div>

        <div className="pointer-events-none mt-auto flex justify-center pb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-xs font-bold text-amber-100/90 backdrop-blur-md">
            <Sparkles size={14} /> Ищите золотую точку
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/45 p-4 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-md animate-[slide-up_0.28s_ease] rounded-3xl border border-amber-300/30 bg-[#12141c]/95 p-6 shadow-2xl shadow-amber-900/20">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-bold uppercase tracking-[0.2em] text-amber-200/80">
                  Family Mode
                </p>
                <h2 className="mt-2 m-0 text-2xl font-extrabold text-white">Инвайт от близкого</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Можно создать защищённое соединение в один шаг — без ручного копирования ссылок.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
                aria-label="Закрыть"
                onClick={() => {
                  setModalOpen(false);
                  setSelectedPos(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <button
              type="button"
              onClick={onCreateConnection}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/50 bg-amber-300/15 px-5 py-4 text-lg font-extrabold text-amber-50 transition hover:bg-amber-300/25"
            >
              Создать соединение
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
