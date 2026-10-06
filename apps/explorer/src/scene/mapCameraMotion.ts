import * as THREE from 'three'
import { MAP_VIEW } from '../theme'

const MOVE_PX = 0.25
const TURN = 1e-7
const ZOOM = 1e-4

/**
 * Tracks camera motion frame to frame. Returns true while the camera moved
 * within the last `MAP_VIEW.labelSettleMs`, including damping drift.
 */
export function createCameraMotion() {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  let zoom = 0
  let primed = false
  let movedAt = -Infinity

  return function isMoving(camera: THREE.Camera, now: number) {
    const nextZoom = 'zoom' in camera ? Number(camera.zoom) || 1 : 1
    if (primed) {
      const shiftPx = camera.position.distanceTo(position) * nextZoom
      const turned = 1 - Math.abs(quaternion.dot(camera.quaternion))
      const zoomed = Math.abs(nextZoom - zoom) / Math.max(zoom, 1e-6)
      if (shiftPx > MOVE_PX || turned > TURN || zoomed > ZOOM) movedAt = now
    }
    position.copy(camera.position)
    quaternion.copy(camera.quaternion)
    zoom = nextZoom
    primed = true
    return now - movedAt < MAP_VIEW.labelSettleMs
  }
}

/** Hides a label layer while moving; CSS fades it back in once settled. */
export function setLayerMoving(layer: HTMLElement, moving: boolean) {
  const value = moving ? 'true' : 'false'
  if (layer.dataset.moving !== value) layer.dataset.moving = value
}
