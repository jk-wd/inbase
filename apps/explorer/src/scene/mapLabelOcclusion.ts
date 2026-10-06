import type * as THREE from 'three'
import { BLUEPRINT_OVERLAY } from '../theme'
import { projectToScreen } from './mapProjection'

/** A raised blueprint folder sheet; ground labels under it are drawn as seen through it. */
export type MapSheet = {
  path: string
  x: number
  z: number
  width: number
  depth: number
  y: number
}

type ScreenQuad = [number, number][]

export type SheetCover = {
  quads: ScreenQuad[]
  /** Opacity of a ground label seen through a sheet. */
  throughOpacity: number
}

export function projectSheets(
  sheets: MapSheet[],
  blueprintOpacity: number,
  camera: THREE.Camera,
  width: number,
  height: number,
): SheetCover {
  const quads: ScreenQuad[] = []
  for (const sheet of sheets) {
    const x0 = sheet.x - sheet.width / 2
    const x1 = sheet.x + sheet.width / 2
    const z0 = sheet.z
    const z1 = sheet.z + sheet.depth
    const corners: [number, number][] = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ]
    const quad: ScreenQuad = []
    let behind = false
    for (const [x, z] of corners) {
      const screen = projectToScreen(x, sheet.y, z, camera, width, height)
      if (screen.behind) behind = true
      quad.push([screen.x, screen.y])
    }
    if (!behind) quads.push(quad)
  }
  return {
    quads,
    throughOpacity: 1 - BLUEPRINT_OVERLAY.folderOpacity * blueprintOpacity,
  }
}

const TITLE_EDGE_PX = 6
const TITLE_GAP_PX = 6
const TITLE_HALF_HEIGHT_PX = 11

/**
 * Screen point for a sheet's folder name: just above its topmost corner, or
 * centered over its top edge when that edge is level (top-down view).
 */
export function sheetTitlePoint(
  sheet: MapSheet,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  const x0 = sheet.x - sheet.width / 2
  const x1 = sheet.x + sheet.width / 2
  const z0 = sheet.z
  const z1 = sheet.z + sheet.depth
  const corners = [
    projectToScreen(x0, sheet.y, z0, camera, width, height),
    projectToScreen(x1, sheet.y, z0, camera, width, height),
    projectToScreen(x1, sheet.y, z1, camera, width, height),
    projectToScreen(x0, sheet.y, z1, camera, width, height),
  ]
  const top = Math.min(...corners.map((corner) => corner.y))
  const edge = corners.filter((corner) => corner.y - top <= TITLE_EDGE_PX)
  return {
    x: edge.reduce((sum, corner) => sum + corner.x, 0) / edge.length,
    y: top - TITLE_GAP_PX - TITLE_HALF_HEIGHT_PX,
    behind: corners.some((corner) => corner.behind),
  }
}

function insideQuad(quad: ScreenQuad, x: number, y: number) {
  let sign = 0
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, ay] = quad[i]
    const [bx, by] = quad[(i + 1) % quad.length]
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross === 0) continue
    const side = cross > 0 ? 1 : -1
    if (sign === 0) sign = side
    else if (side !== sign) return false
  }
  return true
}

export function underSheet(cover: SheetCover, x: number, y: number) {
  for (const quad of cover.quads) {
    if (insideQuad(quad, x, y)) return true
  }
  return false
}
