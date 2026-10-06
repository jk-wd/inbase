import * as THREE from 'three'

export type ScreenPoint = { x: number; y: number; behind: boolean }

export type ScreenFootprint = ScreenPoint & { halfW: number; halfH: number }

/** Ground-plane rectangle covering everything visible between two heights. */
export type MapViewRect = {
  zoom: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const PROJECT = new THREE.Vector3()
const RAY = new THREE.Raycaster()
const NDC = new THREE.Vector2()
const HIT = new THREE.Vector3()
const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export function projectToScreen(
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenPoint {
  PROJECT.set(x, y, z).project(camera)
  return {
    x: (PROJECT.x * 0.5 + 0.5) * width,
    y: (-PROJECT.y * 0.5 + 0.5) * height,
    behind: PROJECT.z < -1 || PROJECT.z > 1,
  }
}

/**
 * Screen center and half extents of a flat rectangle at height `y`. At a
 * straight-down angle this equals `width * zoom / 2` by `depth * zoom / 2`.
 */
export function projectFootprint(
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  camera: THREE.Camera,
  viewWidth: number,
  viewHeight: number,
): ScreenFootprint {
  const center = projectToScreen(x, y, z, camera, viewWidth, viewHeight)
  const hw = width / 2
  const hd = depth / 2
  let halfW = 0
  let halfH = 0
  for (const [dx, dz] of [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ]) {
    const corner = projectToScreen(x + dx, y, z + dz, camera, viewWidth, viewHeight)
    halfW = Math.max(halfW, Math.abs(corner.x - center.x))
    halfH = Math.max(halfH, Math.abs(corner.y - center.y))
  }
  return { ...center, halfW, halfH }
}

/**
 * Casts the padded screen corners onto horizontal planes at each height and
 * returns the ground bounds they span. Works for any tilt or heading.
 */
export function mapViewRect(
  camera: THREE.Camera,
  width: number,
  height: number,
  padPx: number,
  heights: number[],
): MapViewRect {
  const zoom = 'zoom' in camera ? Number(camera.zoom) : 1
  const padX = 1 + (2 * padPx) / Math.max(width, 1)
  const padY = 1 + (2 * padPx) / Math.max(height, 1)
  const rect: MapViewRect = {
    zoom,
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }
  for (const sx of [-padX, padX]) {
    for (const sy of [-padY, padY]) {
      NDC.set(sx, sy)
      RAY.setFromCamera(NDC, camera)
      for (const h of heights) {
        PLANE.constant = -h
        if (!RAY.ray.intersectPlane(PLANE, HIT)) continue
        rect.minX = Math.min(rect.minX, HIT.x)
        rect.maxX = Math.max(rect.maxX, HIT.x)
        rect.minZ = Math.min(rect.minZ, HIT.z)
        rect.maxZ = Math.max(rect.maxZ, HIT.z)
      }
    }
  }
  if (!Number.isFinite(rect.minX)) {
    rect.minX = -Infinity
    rect.maxX = Infinity
    rect.minZ = -Infinity
    rect.maxZ = Infinity
  }
  return rect
}
