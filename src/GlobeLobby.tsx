import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, MapPin, Phone, X, ZoomIn, ZoomOut } from 'lucide-react';
import { initials } from './identity';
import type { PresenceUser } from './presence';

export type MapPerson = PresenceUser & {
  isContact: boolean;
  isMe?: boolean;
};

type GlobeLobbyProps = {
  onBack: () => void;
  people: MapPerson[];
  geoSource: 'gps' | 'antarctica' | 'pending';
  onCallUser: (user: MapPerson) => void;
};

const SPHERE_RADIUS = 8;
const EARTH_TEX =
  'https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg';
const FOV_DEFAULT = 72;
const FOV_MIN = 28;
const FOV_MAX = 98;
const FOV_FOCUS = 38;

/** lat/lng → точка на внутренней поверхности сферы (вид из центра). */
export function latLngToPosition(
  lat: number,
  lng: number,
  radius = SPHERE_RADIUS
): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return [x, y, z];
}

function directionToYawPitch(dir: THREE.Vector3): { yaw: number; pitch: number } {
  const d = dir.clone().normalize();
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  return { yaw, pitch };
}

function LookAroundControls({
  enabled,
  yawRef,
  pitchRef,
  fovRef,
  fovTargetRef,
  onFovChange,
}: {
  enabled: boolean;
  yawRef: MutableRefObject<number>;
  pitchRef: MutableRefObject<number>;
  fovRef: MutableRefObject<number>;
  fovTargetRef: MutableRefObject<number>;
  onFovChange: (fov: number) => void;
}) {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const pinchDist = useRef<number | null>(null);
  const reportedFov = useRef(fovRef.current);

  useEffect(() => {
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fovRef.current;
      camera.updateProjectionMatrix();
    }
  }, [camera, fovRef]);

  useFrame(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    // Плавный lerp FOV → целевой зум
    const target = fovTargetRef.current;
    fovRef.current += (target - fovRef.current) * 0.14;
    if (Math.abs(camera.fov - fovRef.current) > 0.02) {
      camera.fov = fovRef.current;
      camera.updateProjectionMatrix();
    }
    if (Math.abs(reportedFov.current - fovRef.current) > 0.4) {
      reportedFov.current = fovRef.current;
      onFovChange(fovRef.current);
    }

    if (!enabled) return;
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current;
    const zoomT = (FOV_MAX - fovRef.current) / (FOV_MAX - FOV_MIN);
    const dolly = zoomT * SPHERE_RADIUS * 0.74;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.copy(forward.multiplyScalar(dolly));
  });

  useEffect(() => {
    const el = gl.domElement;

    const clampFovTarget = (next: number) => {
      fovTargetRef.current = Math.min(FOV_MAX, Math.max(FOV_MIN, next));
    };

    const onDown = (e: PointerEvent) => {
      if (!enabled || e.pointerType === 'touch') return;
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!enabled || !dragging.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      const sens = 0.0032 + (fovRef.current / FOV_MAX) * 0.0022;
      yawRef.current -= dx * sens;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - dy * sens,
        -1.35,
        1.35
      );
    };
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? 3.5 : -3.5;
      clampFovTarget(fovTargetRef.current + step);
    };

    const touchDist = (touches: TouchList) => {
      if (touches.length < 2) return null;
      const a = touches[0]!;
      const b = touches[1]!;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!enabled) return;
      if (e.touches.length === 2) {
        pinchDist.current = touchDist(e.touches);
        dragging.current = false;
      } else if (e.touches.length === 1) {
        const t = e.touches[0]!;
        dragging.current = true;
        last.current = { x: t.clientX, y: t.clientY };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!enabled) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = touchDist(e.touches);
        if (dist == null || pinchDist.current == null) return;
        const delta = pinchDist.current - dist;
        pinchDist.current = dist;
        clampFovTarget(fovTargetRef.current + delta * 0.045);
        return;
      }
      if (!dragging.current || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dx = t.clientX - last.current.x;
      const dy = t.clientY - last.current.y;
      last.current = { x: t.clientX, y: t.clientY };
      const sens = 0.0038 + (fovRef.current / FOV_MAX) * 0.002;
      yawRef.current -= dx * sens;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - dy * sens,
        -1.35,
        1.35
      );
    };
    const onTouchEnd = () => {
      if (pinchDist.current != null) pinchDist.current = null;
      dragging.current = false;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, gl, yawRef, pitchRef, fovRef, fovTargetRef, onFovChange]);

  return null;
}

function CameraFlyTo({
  target,
  active,
  yawRef,
  pitchRef,
  fovTargetRef,
}: {
  target: [number, number, number] | null;
  active: boolean;
  yawRef: MutableRefObject<number>;
  pitchRef: MutableRefObject<number>;
  fovTargetRef: MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const progress = useRef(0);
  const startYaw = useRef(0);
  const startPitch = useRef(0);
  const endYaw = useRef(0);
  const endPitch = useRef(0);
  const flyingKey = useRef<string | null>(null);

  useFrame((_, dt) => {
    if (!active || !target) {
      progress.current = 0;
      flyingKey.current = null;
      return;
    }

    const key = target.join(',');
    if (flyingKey.current !== key) {
      flyingKey.current = key;
      progress.current = 0;
      startYaw.current = yawRef.current;
      startPitch.current = pitchRef.current;
      const { yaw, pitch } = directionToYawPitch(new THREE.Vector3(...target));
      // Кратчайший путь по yaw
      let dy = yaw - startYaw.current;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      endYaw.current = startYaw.current + dy;
      endPitch.current = pitch;
      fovTargetRef.current = FOV_FOCUS;
    }

    progress.current = Math.min(1, progress.current + dt * 0.85);
    const t = 1 - (1 - progress.current) ** 3;
    yawRef.current = THREE.MathUtils.lerp(startYaw.current, endYaw.current, t);
    pitchRef.current = THREE.MathUtils.lerp(startPitch.current, endPitch.current, t);

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current;
    const zoomT = (FOV_MAX - fovTargetRef.current) / (FOV_MAX - FOV_MIN);
    const dolly = zoomT * SPHERE_RADIUS * 0.74 * t;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.copy(forward.multiplyScalar(dolly));
  });

  return null;
}

function EarthShell() {
  const texture = useLoader(THREE.TextureLoader, EARTH_TEX);
  texture.colorSpace = THREE.SRGBColorSpace;

  return (
    <mesh>
      <sphereGeometry args={[SPHERE_RADIUS, 72, 72]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
}

function Atmosphere() {
  return (
    <mesh>
      <sphereGeometry args={[SPHERE_RADIUS * 0.992, 48, 48]} />
      <meshBasicMaterial
        color="#0a1628"
        side={THREE.BackSide}
        transparent
        opacity={0.22}
        depthWrite={false}
      />
    </mesh>
  );
}

function MapPersonBadge({
  person,
  selected,
  onSelect,
  goldFallback,
}: {
  person: MapPerson;
  selected: boolean;
  onSelect: () => void;
  goldFallback?: boolean;
}) {
  const over = () => {
    document.body.style.cursor = 'pointer';
  };
  const out = () => {
    document.body.style.cursor = 'default';
  };
  const hasPhoto = Boolean(person.avatarUrl);

  return (
    <button
      type="button"
      className={`relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 text-xs font-extrabold text-white shadow-lg transition ${
        selected
          ? 'scale-110 border-white'
          : goldFallback && !hasPhoto
            ? 'border-amber-300/70'
            : 'border-white/70 hover:scale-105'
      }`}
      style={{
        background: hasPhoto
          ? '#1a1d28'
          : goldFallback && !hasPhoto
            ? '#f59e0b'
            : person.color,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={over}
      onPointerOut={out}
      aria-label={person.name}
    >
      {hasPhoto ? (
        <img
          src={person.avatarUrl}
          alt=""
          className="h-full w-full rounded-full object-cover"
          draggable={false}
        />
      ) : goldFallback ? (
        <span className="text-base leading-none">·</span>
      ) : (
        initials(person.name)
      )}
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#03050a] bg-emerald-400" />
    </button>
  );
}

function AvatarMarker({
  person,
  position,
  selected,
  onSelect,
  goldFallback,
}: {
  person: MapPerson;
  position: [number, number, number];
  selected: boolean;
  onSelect: () => void;
  goldFallback?: boolean;
}) {
  return (
    <group position={position}>
      <Html center distanceFactor={9} style={{ pointerEvents: 'auto' }} zIndexRange={[100, 0]}>
        <MapPersonBadge
          person={person}
          selected={selected}
          onSelect={onSelect}
          goldFallback={goldFallback}
        />
      </Html>
    </group>
  );
}

function MapScene({
  people,
  selectedId,
  onSelect,
  flying,
  yawRef,
  pitchRef,
  fovRef,
  fovTargetRef,
  onFovChange,
  flyTarget,
}: {
  people: MapPerson[];
  selectedId: string | null;
  onSelect: (person: MapPerson, pos: [number, number, number]) => void;
  flying: boolean;
  yawRef: MutableRefObject<number>;
  pitchRef: MutableRefObject<number>;
  fovRef: MutableRefObject<number>;
  fovTargetRef: MutableRefObject<number>;
  onFovChange: (fov: number) => void;
  flyTarget: [number, number, number] | null;
}) {
  return (
    <>
      <color attach="background" args={['#02040a']} />
      <ambientLight intensity={0.55} />
      <LookAroundControls
        enabled={!flying}
        yawRef={yawRef}
        pitchRef={pitchRef}
        fovRef={fovRef}
        fovTargetRef={fovTargetRef}
        onFovChange={onFovChange}
      />
      <CameraFlyTo
        target={flyTarget}
        active={flying}
        yawRef={yawRef}
        pitchRef={pitchRef}
        fovTargetRef={fovTargetRef}
      />
      <Suspense fallback={null}>
        <EarthShell />
      </Suspense>
      <Atmosphere />

      {people.map((person) => {
        const pos = latLngToPosition(person.lat, person.lng);
        if (person.isMe) {
          return (
            <group key={person.userId} position={pos}>
              <Html center distanceFactor={10} style={{ pointerEvents: 'none' }}>
                <div className="relative flex flex-col items-center">
                  <div
                    className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-teal-300/70 shadow-lg"
                    style={{ background: person.avatarUrl ? '#1a1d28' : person.color }}
                  >
                    {person.avatarUrl ? (
                      <img
                        src={person.avatarUrl}
                        alt=""
                        className="h-full w-full rounded-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs font-extrabold text-white">
                        {initials(person.name)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 whitespace-nowrap rounded-full border border-teal-300/40 bg-black/55 px-2.5 py-1 text-center text-[10px] font-bold text-teal-100">
                    Вы
                  </div>
                </div>
              </Html>
            </group>
          );
        }
        return (
          <AvatarMarker
            key={person.userId}
            person={person}
            position={pos}
            selected={selectedId === person.userId}
            onSelect={() => onSelect(person, pos)}
            goldFallback={!person.isContact && !person.avatarUrl}
          />
        );
      })}
    </>
  );
}

export default function GlobeLobby({
  onBack,
  people,
  geoSource,
  onCallUser,
}: GlobeLobbyProps) {
  const [selected, setSelected] = useState<MapPerson | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number, number] | null>(null);
  const [flying, setFlying] = useState(false);
  const [fov, setFov] = useState(FOV_DEFAULT);
  const fovRef = useRef(FOV_DEFAULT);
  const fovTargetRef = useRef(FOV_DEFAULT);
  const yawRef = useRef(0.4);
  const pitchRef = useRef(-0.08);
  const flyEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contacts = useMemo(
    () => people.filter((p) => p.isContact && !p.isMe),
    [people]
  );

  const focusOn = (person: MapPerson, openCard = true) => {
    const pos = latLngToPosition(person.lat, person.lng);
    setFlyTarget(pos);
    setFlying(true);
    if (openCard) setSelected(person);
    if (flyEndTimer.current) clearTimeout(flyEndTimer.current);
    flyEndTimer.current = setTimeout(() => setFlying(false), 1400);
  };

  useEffect(() => {
    return () => {
      if (flyEndTimer.current) clearTimeout(flyEndTimer.current);
    };
  }, []);

  const nudgeZoom = (delta: number) => {
    fovTargetRef.current = Math.min(
      FOV_MAX,
      Math.max(FOV_MIN, fovTargetRef.current + delta)
    );
  };

  const geoHint =
    geoSource === 'gps'
      ? 'Ваша точка — по GPS'
      : geoSource === 'antarctica'
        ? 'Без GPS вы в условной Антарктиде'
        : 'Запрашиваем геолокацию…';

  return (
    <div className="relative h-svh w-full overflow-hidden bg-[#03050a] font-[Nunito,system-ui,sans-serif] text-slate-200">
      <Canvas
        camera={{ position: [0, 0, 0], fov: FOV_DEFAULT, near: 0.05, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ camera }) => {
          camera.rotation.order = 'YXZ';
          camera.position.set(0, 0, 0);
        }}
        className="absolute inset-0 touch-none"
      >
        <Suspense fallback={null}>
          <MapScene
            people={people}
            selectedId={selected?.userId ?? null}
            flying={flying}
            yawRef={yawRef}
            pitchRef={pitchRef}
            fovRef={fovRef}
            fovTargetRef={fovTargetRef}
            onFovChange={setFov}
            flyTarget={flyTarget}
            onSelect={(person, pos) => {
              setFlyTarget(pos);
              setFlying(true);
              setSelected(person);
              if (flyEndTimer.current) clearTimeout(flyEndTimer.current);
              flyEndTimer.current = setTimeout(() => setFlying(false), 1400);
            }}
          />
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <header className="pointer-events-auto flex items-center justify-between px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px]">
            Family Mode
          </div>
        </header>

        <div className="pointer-events-none mt-2 px-4 text-center sm:px-6">
          <p className="mx-auto max-w-md text-sm text-slate-400 sm:text-base">
            Колесо / щипок — зум. Нажмите аватар друга — камера плавно летит к нему.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md">
            <MapPin size={12} /> {geoHint}
          </p>
        </div>

        <div className="pointer-events-auto mt-auto flex flex-col gap-3 px-4 pb-6 sm:px-6">
          {contacts.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-white/15 bg-white/[0.07] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-[18px]">
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Близкие
              </p>
              <div className="flex gap-3">
                {contacts.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    className="flex w-16 shrink-0 flex-col items-center gap-1.5"
                    onClick={() => focusOn(c)}
                    aria-label={`Найти ${c.name} на карте`}
                  >
                    <span
                      className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-white/50 shadow-md"
                      style={{ background: c.avatarUrl ? '#1a1d28' : c.color }}
                    >
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt=""
                          className="h-full w-full rounded-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs font-extrabold text-white">
                          {initials(c.name)}
                        </span>
                      )}
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0a0c12] bg-emerald-400" />
                    </span>
                    <span className="max-w-full truncate text-[11px] font-bold text-slate-200">
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-label="Приблизить"
                onClick={() => nudgeZoom(-8)}
                disabled={fov <= FOV_MIN + 0.5}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15 disabled:opacity-35"
              >
                <ZoomIn size={18} />
              </button>
              <button
                type="button"
                aria-label="Отдалить"
                onClick={() => nudgeZoom(8)}
                disabled={fov >= FOV_MAX - 0.5}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15 disabled:opacity-35"
              >
                <ZoomOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[8px] sm:items-center">
          <div className="w-full max-w-md animate-[slide-up_0.28s_ease] rounded-3xl border border-white/20 bg-white/[0.08] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-[24px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-extrabold text-white"
                  style={{
                    background: selected.avatarUrl
                      ? '#1a1d28'
                      : selected.isContact
                        ? selected.color
                        : '#f59e0b',
                  }}
                >
                  {selected.avatarUrl ? (
                    <img
                      src={selected.avatarUrl}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                      draggable={false}
                    />
                  ) : selected.isContact ? (
                    initials(selected.name)
                  ) : (
                    '·'
                  )}
                  <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#12141c] bg-emerald-400" />
                </div>
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                    {selected.isContact ? 'Контакт' : 'В сети'}
                  </p>
                  <h2 className="mt-1 m-0 text-2xl font-extrabold text-white">
                    {selected.isContact ? selected.name : 'Незнакомец'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {selected.lat.toFixed(1)}°, {selected.lng.toFixed(1)}°
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Закрыть"
                onClick={() => {
                  setSelected(null);
                  setFlying(false);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onCallUser(selected)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-lg font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_24px_rgba(255,255,255,0.06)] transition hover:bg-white/15"
            >
              <Phone size={22} /> Позвонить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
