import { CONFIG, MAP_BRIDGE } from '../theme'
import type { PlacedBridge } from '../types'

export type MapBridgePiece = {
  key: string
  x: number
  z: number
  width: number
  depth: number
}

/** Moves `from` toward `to` by `amount`, never past `to`. */
function pullToward(
  from: [number, number],
  to: [number, number],
  amount: number,
): [number, number] {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.001) return from
  const t = Math.min(amount, length) / length
  return [from[0] + dx * t, from[1] + dz * t]
}

/**
 * Bridge routes start and end `bridgeOverlap` inside their folders so walk mode
 * has a seamless deck. On the map the ends are trimmed back to the folder edges,
 * leaving one thick axis-aligned line between the folders.
 */
export function mapBridgeLine(
  bridge: PlacedBridge,
  width = MAP_BRIDGE.lineWidth,
): MapBridgePiece[] {
  const points = bridge.points.map((point) => [point[0], point[1]] as [number, number])
  if (points.length < 2) return []
  points[0] = pullToward(points[0], points[1], CONFIG.bridgeOverlap)
  const last = points.length - 1
  points[last] = pullToward(points[last], points[last - 1], CONFIG.bridgeOverlap)

  const pieces: MapBridgePiece[] = []
  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1]
    const [x1, z1] = points[i]
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
    const a = alongX ? x0 : z0
    const b = alongX ? x1 : z1
    if (Math.abs(b - a) < 0.01) continue
    const dir = Math.sign(b - a)
    // Overrun into interior corners so consecutive segments join without a notch.
    const start = a - (i > 1 ? dir * (width / 2) : 0)
    const end = b + (i < last ? dir * (width / 2) : 0)
    const center = (start + end) / 2
    const length = Math.abs(end - start)
    pieces.push({
      key: `seg-${i}`,
      x: alongX ? center : x0,
      z: alongX ? z0 : center,
      width: alongX ? length : width,
      depth: alongX ? width : length,
    })
  }
  return pieces
}
