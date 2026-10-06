import * as THREE from 'three'
import type { MapControlsHandle } from './mapCamera'

/**
 * OrbitControls always orbits its target (the screen center). To orbit around
 * the map point under the mouse instead, the camera and target slide sideways
 * after every controls update so that point stays under the same pixel.
 */
export type OrbitPivot = {
  point: THREE.Vector3
  ndc: THREE.Vector2
  releasedAt: number | null
}

/** Damping keeps rotating briefly after release; keep pinning the pivot until it settles. */
const PIVOT_SETTLE_MS = 1000

const RAYCASTER = new THREE.Raycaster()
const PLANE = new THREE.Plane()
const UP = new THREE.Vector3(0, 1, 0)
const HIT = new THREE.Vector3()

/** Same modifiers OrbitControls uses to turn a left-drag pan into a rotate. */
export function isOrbitGesture(event: PointerEvent) {
  if (event.button === 1) return true
  return event.button === 0 && (event.shiftKey || event.metaKey || event.ctrlKey)
}

export function pivotSettled(pivot: OrbitPivot, now: number) {
  return pivot.releasedAt !== null && now - pivot.releasedAt > PIVOT_SETTLE_MS
}

/** Slide camera and target in the pivot's horizontal plane; exact for an orthographic camera. */
export function holdOrbitPivot(
  camera: THREE.Camera,
  controls: MapControlsHandle,
  pivot: OrbitPivot,
) {
  camera.updateMatrixWorld()
  RAYCASTER.setFromCamera(pivot.ndc, camera)
  PLANE.set(UP, -pivot.point.y)
  if (!RAYCASTER.ray.intersectPlane(PLANE, HIT)) return
  const dx = pivot.point.x - HIT.x
  const dz = pivot.point.z - HIT.z
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return
  camera.position.x += dx
  camera.position.z += dz
  controls.target.x += dx
  controls.target.z += dz
  camera.updateMatrixWorld()
}
