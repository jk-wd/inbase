import * as THREE from 'three'
import { MAP_BLOCK_SHADE } from '../theme'

function faceShade(nx: number, ny: number, nz: number) {
  if (ny > 0.5) return MAP_BLOCK_SHADE.top
  if (ny < -0.5) return MAP_BLOCK_SHADE.bottom
  if (nx > 0.5) return MAP_BLOCK_SHADE.east
  if (nx < -0.5) return MAP_BLOCK_SHADE.west
  return nz > 0 ? MAP_BLOCK_SHADE.south : MAP_BLOCK_SHADE.north
}

function shadedUnitBox() {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const normals = geometry.getAttribute('normal')
  const colors = new Float32Array(normals.count * 3)
  for (let i = 0; i < normals.count; i += 1) {
    const shade = faceShade(normals.getX(i), normals.getY(i), normals.getZ(i))
    colors[i * 3] = shade
    colors[i * 3 + 1] = shade
    colors[i * 3 + 2] = shade
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/**
 * Unit box shared by every map block. Pair it with an unlit material that has
 * `vertexColors` so each face is tinted by its MAP_BLOCK_SHADE entry. Mount it
 * as a `<primitive>` so React Three Fiber never disposes the shared instance.
 */
export const MAP_BLOCK_GEOMETRY = shadedUnitBox()
