import * as THREE from 'three'
import type { MapViewAngle } from '../mapViewAngle'
import { MAP_VIEW } from '../theme'

/**
 * Where the map camera looks. `cx`/`cz`/`width`/`depth` describe the ground
 * area to fit; `tilt` is the angle from straight down and `heading` the
 * rotation around the vertical axis (0 keeps north up).
 */
export type MapPose = {
  cx: number
  cz: number
  width: number
  depth: number
  tilt: number
  heading: number
}

export type MapAngle = MapViewAngle

export type MapViewport = {
  width: number
  height: number
  hudReserve: number
}

export type MapControlsHandle = {
  target: THREE.Vector3
  update: () => void
}

export type MapFlight = {
  from: MapPose
  via: MapPose
  to: MapPose
  start: number
  duration: number
  split: number
}

export const MAP_TOP_DOWN: MapAngle = { tilt: 0, heading: 0 }
export const MAP_MAX_TILT = THREE.MathUtils.degToRad(MAP_VIEW.maxTiltDeg)
/** Exactly straight down makes lookAt degenerate with a Y-up camera. */
const MIN_TILT = 1e-4
const FIT_PAD = 36
const FIT_FILL = 0.92
const MIN_ZOOM = 0.08

const FORWARD = new THREE.Vector3()
const OFFSET = new THREE.Vector3()
const TARGET = new THREE.Vector3()

export function clampTilt(tilt: number) {
  return Math.min(MAP_MAX_TILT, Math.max(MIN_TILT, tilt))
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function poseOf(
  bounds: { cx: number; cz: number; width: number; depth: number },
  angle: MapAngle = MAP_TOP_DOWN,
): MapPose {
  return {
    cx: bounds.cx,
    cz: bounds.cz,
    width: bounds.width,
    depth: bounds.depth,
    tilt: angle.tilt,
    heading: angle.heading,
  }
}

/** Camera distance that keeps the whole world in front of the near plane at max tilt. */
export function mapCameraDistance(world: { width: number; depth: number }) {
  return Math.max(800, (world.width + world.depth) * 2)
}

export function fitZoomFor(
  bounds: { width: number; depth: number },
  view: Pick<MapViewport, 'width' | 'height'>,
) {
  return Math.min(
    view.width / Math.max(bounds.width + FIT_PAD, 1),
    view.height / Math.max(bounds.depth + FIT_PAD, 1),
  )
}

/**
 * The bottom HUD hides part of the canvas, so the fitted area sits a bit above
 * screen center. Shift along the screen's downward ground direction; tilting
 * stretches one screen pixel over 1 / cos(tilt) of ground.
 */
function hudShift(angle: MapAngle, zoom: number, hudReserve: number) {
  const ground = hudReserve / 2 / zoom / Math.cos(clampTilt(angle.tilt))
  return {
    x: Math.sin(angle.heading) * ground,
    z: Math.cos(angle.heading) * ground,
  }
}

export function applyMapPose(
  camera: THREE.OrthographicCamera,
  pose: MapPose,
  view: MapViewport,
  distance: number,
  controls: MapControlsHandle | null,
) {
  const zoom = Math.max(fitZoomFor(pose, view) * FIT_FILL, MIN_ZOOM)
  const tilt = clampTilt(pose.tilt)
  const shift = hudShift(pose, zoom, view.hudReserve)
  const tx = pose.cx + shift.x
  const tz = pose.cz + shift.z
  const reach = distance * Math.sin(tilt)
  camera.up.set(0, 1, 0)
  camera.position.set(
    tx + reach * Math.sin(pose.heading),
    distance * Math.cos(tilt),
    tz + reach * Math.cos(pose.heading),
  )
  camera.lookAt(tx, 0, tz)
  camera.near = 1
  camera.far = distance * 3
  camera.zoom = zoom
  camera.updateProjectionMatrix()
  if (controls) {
    controls.target.set(tx, 0, tz)
    controls.update()
  }
}

/** Ground point at the center of the screen. */
export function mapGroundTarget(
  camera: THREE.Camera,
  controls: MapControlsHandle | null,
  out = TARGET,
) {
  if (controls) return out.copy(controls.target)
  FORWARD.set(0, 0, -1).applyQuaternion(camera.quaternion)
  if (FORWARD.y > -1e-6) return out.set(camera.position.x, 0, camera.position.z)
  const t = -camera.position.y / FORWARD.y
  return out.copy(camera.position).addScaledVector(FORWARD, t)
}

export function angleFromCamera(
  camera: THREE.Camera,
  controls: MapControlsHandle | null,
): MapAngle {
  const target = mapGroundTarget(camera, controls)
  OFFSET.copy(camera.position).sub(target)
  const length = OFFSET.length()
  if (length < 1e-9) return { ...MAP_TOP_DOWN }
  return {
    tilt: Math.acos(Math.min(1, Math.max(-1, OFFSET.y / length))),
    heading: Math.atan2(OFFSET.x, OFFSET.z),
  }
}

export function poseFromCamera(
  camera: THREE.OrthographicCamera,
  view: MapViewport,
  controls: MapControlsHandle | null,
): MapPose {
  const zoom = Math.max(camera.zoom, 0.001)
  const angle = angleFromCamera(camera, controls)
  const target = mapGroundTarget(camera, controls)
  const shift = hudShift(angle, zoom, view.hudReserve)
  return {
    cx: target.x - shift.x,
    cz: target.z - shift.z,
    width: Math.max((view.width * FIT_FILL) / zoom - FIT_PAD, 1),
    depth: Math.max((view.height * FIT_FILL) / zoom - FIT_PAD, 1),
    tilt: angle.tilt,
    heading: angle.heading,
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number) {
  return a + wrapAngle(b - a) * t
}

function lerpPose(a: MapPose, b: MapPose, t: number): MapPose {
  return {
    cx: lerp(a.cx, b.cx, t),
    cz: lerp(a.cz, b.cz, t),
    width: lerp(a.width, b.width, t),
    depth: lerp(a.depth, b.depth, t),
    tilt: lerp(a.tilt, b.tilt, t),
    heading: lerpAngle(a.heading, b.heading, t),
  }
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function flightPose(flight: MapFlight, now: number) {
  const t = Math.min(1, (now - flight.start) / flight.duration)
  const pose =
    flight.split <= 0
      ? lerpPose(flight.from, flight.to, easeInOutCubic(t))
      : t < flight.split
        ? lerpPose(flight.from, flight.via, easeInOutCubic(t / flight.split))
        : lerpPose(
            flight.via,
            flight.to,
            easeInOutCubic((t - flight.split) / (1 - flight.split)),
          )
  return { t, pose }
}
