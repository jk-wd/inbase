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

/**
 * One continuous camera move. `lift` widens the view mid-flight (0 = none,
 * 1 = twice the span at the halfway point) so long hops zoom out a little.
 */
export type MapFlight = {
  from: MapPose
  to: MapPose
  start: number
  duration: number
  lift: number
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

/** Zoom feels even when the span changes by the same factor each frame. */
function lerpSpan(a: number, b: number, t: number) {
  return Math.exp(lerp(Math.log(Math.max(a, 1e-3)), Math.log(Math.max(b, 1e-3)), t))
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function flightPose(flight: MapFlight, now: number) {
  const t = Math.min(1, (now - flight.start) / flight.duration)
  const e = easeInOutCubic(t)
  const { from, to } = flight
  const widen = 1 + flight.lift * Math.sin(Math.PI * e)
  const pose: MapPose = {
    cx: lerp(from.cx, to.cx, e),
    cz: lerp(from.cz, to.cz, e),
    width: lerpSpan(from.width, to.width, e) * widen,
    depth: lerpSpan(from.depth, to.depth, e) * widen,
    tilt: lerp(from.tilt, to.tilt, e),
    heading: lerpAngle(from.heading, to.heading, e),
  }
  return { t, pose }
}

/** How far the mid-flight view widens per unit of travel, relative to the view span. */
const LIFT_PER_TRAVEL = 0.45
const MIN_FLIGHT_MS = 700
const MAX_FLIGHT_MS = 1700

/**
 * Plan a smooth hop from `from` to `to`. Nearby targets glide straight over;
 * farther ones zoom out proportionally to the distance, never past `maxSpan`.
 */
export function planFlight(
  from: MapPose,
  to: MapPose,
  maxSpan: number,
  start = performance.now(),
): MapFlight {
  const span = Math.sqrt(
    Math.max(from.width, from.depth) * Math.max(to.width, to.depth),
  )
  const travel = Math.hypot(to.cx - from.cx, to.cz - from.cz) / Math.max(span, 1)
  const peak = Math.min(span * (1 + travel * LIFT_PER_TRAVEL), Math.max(maxSpan, span))
  const lift = travel > 0.6 ? Math.max(0, peak / span - 1) : 0
  const zoomChange = Math.abs(
    Math.log2(Math.max(to.width, 1e-3) / Math.max(from.width, 1e-3)),
  )
  const duration = Math.min(
    MAX_FLIGHT_MS,
    Math.max(MIN_FLIGHT_MS, 650 + 320 * Math.log2(1 + travel) + 120 * zoomChange),
  )
  return { from, to, start, duration, lift }
}
