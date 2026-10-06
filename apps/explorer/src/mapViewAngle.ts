/**
 * Shares the map camera angle between the canvas and the HUD without
 * re-rendering the app on every camera frame.
 */
export type MapViewAngle = {
  /** Radians from straight down. */
  tilt: number
  /** Radians around the vertical axis. 0 keeps north up. */
  heading: number
}

const PUBLISH_EPSILON = 0.002

let current: MapViewAngle = { tilt: 0, heading: 0 }
const listeners = new Set<() => void>()
const resetListeners = new Set<() => void>()

export function getMapViewAngle() {
  return current
}

export function subscribeMapViewAngle(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishMapViewAngle(next: MapViewAngle) {
  if (
    Math.abs(next.tilt - current.tilt) < PUBLISH_EPSILON &&
    Math.abs(next.heading - current.heading) < PUBLISH_EPSILON
  ) {
    return
  }
  current = { tilt: next.tilt, heading: next.heading }
  for (const listener of listeners) listener()
}

export function isTopDownAngle(angle: MapViewAngle) {
  const heading = Math.atan2(Math.sin(angle.heading), Math.cos(angle.heading))
  return angle.tilt < 0.01 && Math.abs(heading) < 0.01
}

export function requestMapViewReset() {
  for (const listener of resetListeners) listener()
}

export function onMapViewResetRequest(listener: () => void) {
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}
