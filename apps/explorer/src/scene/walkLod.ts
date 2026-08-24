import { CONFIG } from '../theme'
import type { PlacedBridge, PlacedFile, PlacedFolder } from '../types'

export const WALK_MESH_RADIUS = 120
export const WALK_MESH_KEEP = 148
export const WALK_LABEL_RADIUS = 28
export const WALK_LABEL_KEEP = 36
export const WALK_FOLDER_PAD = 160
export const WALK_FOLDER_LABEL = 18
export const WALK_AROUND = 14
export const WALK_BEHIND_DOT = -0.18

export type WalkLod = {
  files: Set<string>
  labels: Set<string>
  folders: Set<string>
  folderLabels: Set<string>
  bridges: Set<string>
}

export function folderDistance(
  px: number,
  pz: number,
  folder: PlacedFolder,
): number {
  const halfW = folder.width / 2
  const minX = folder.x - halfW
  const maxX = folder.x + halfW
  const minZ = folder.z
  const maxZ = folder.z + folder.depth
  const cx = Math.min(maxX, Math.max(minX, px))
  const cz = Math.min(maxZ, Math.max(minZ, pz))
  return Math.hypot(px - cx, pz - cz)
}

function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

function bridgeDistance(
  px: number,
  pz: number,
  bridge: PlacedBridge,
): number {
  let nearest = Infinity
  for (let i = 1; i < bridge.points.length; i += 1) {
    const from = bridge.points[i - 1]
    const to = bridge.points[i]
    nearest = Math.min(
      nearest,
      distanceToSegment(px, pz, from[0], from[1], to[0], to[1]),
    )
  }
  if (!Number.isFinite(nearest) && bridge.points[0]) {
    return Math.hypot(px - bridge.points[0][0], pz - bridge.points[0][1])
  }
  return nearest
}

function inFrontOrNearby(
  dx: number,
  dz: number,
  lookX: number,
  lookZ: number,
): boolean {
  const distSq = dx * dx + dz * dz
  if (distSq <= WALK_AROUND * WALK_AROUND) return true
  const dist = Math.sqrt(distSq)
  return (dx / dist) * lookX + (dz / dist) * lookZ >= WALK_BEHIND_DOT
}

export function walkLodCell(
  x: number,
  z: number,
  y: number,
  lookX: number,
  lookZ: number,
) {
  const angle = Math.atan2(lookX, lookZ)
  const bucket = Math.round(angle / (Math.PI / 10))
  const heightBand = Math.round(Math.max(0, y - CONFIG.eyeHeight) / 6)
  return `${Math.round(x / 4)}:${Math.round(z / 4)}:${heightBand}:${bucket}`
}

function sameSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false
  for (const id of left) {
    if (!right.has(id)) return false
  }
  return true
}

export function sameWalkLod(left: WalkLod | null, right: WalkLod) {
  if (!left) return false
  return (
    sameSet(left.files, right.files) &&
    sameSet(left.labels, right.labels) &&
    sameSet(left.folders, right.folders) &&
    sameSet(left.folderLabels, right.folderLabels) &&
    sameSet(left.bridges, right.bridges)
  )
}

export function heightBoost(y: number) {
  return Math.max(0, y - CONFIG.eyeHeight)
}

export function computeWalkLod({
  x,
  z,
  y = CONFIG.eyeHeight,
  lookX,
  lookZ,
  files,
  folders,
  bridges,
  keepFileIds,
  keepFolderPaths,
  prev,
}: {
  x: number
  z: number
  y?: number
  lookX: number
  lookZ: number
  files: Record<string, PlacedFile>
  folders: Record<string, PlacedFolder>
  bridges: PlacedBridge[]
  keepFileIds: Iterable<string>
  keepFolderPaths: Iterable<string>
  prev: WalkLod | null
}): WalkLod {
  const boost = heightBoost(y)
  const meshRadius = WALK_MESH_RADIUS + boost * 2.4
  const meshKeep = WALK_MESH_KEEP + boost * 2.4
  const labelRadius = WALK_LABEL_RADIUS + boost * 0.6
  const labelKeep = WALK_LABEL_KEEP + boost * 0.6
  const folderPad = WALK_FOLDER_PAD + boost * 3
  const lookLen = Math.hypot(lookX, lookZ) || 1
  const nx = lookX / lookLen
  const nz = lookZ / lookLen

  const nextFiles = new Set<string>()
  const nextLabels = new Set<string>()
  for (const id of keepFileIds) nextFiles.add(id)

  for (const [id, placed] of Object.entries(files)) {
    const dx = placed.position[0] - x
    const dz = placed.position[2] - z
    const dist = Math.hypot(dx, dz)
    const kept = Boolean(prev?.files.has(id))
    const labeled = Boolean(prev?.labels.has(id))
    const meshLimit = kept ? meshKeep : meshRadius
    const labelLimit = labeled ? labelKeep : labelRadius
    if (dist > meshLimit) continue
    if (!inFrontOrNearby(dx, dz, nx, nz) && dist > WALK_AROUND) continue
    nextFiles.add(id)
    if (dist <= labelLimit) nextLabels.add(id)
  }

  const nextFolders = new Set<string>()
  const nextFolderLabels = new Set<string>()
  for (const path of keepFolderPaths) nextFolders.add(path)

  for (const folder of Object.values(folders)) {
    const dist = folderDistance(x, z, folder)
    const kept = Boolean(prev?.folders.has(folder.path))
    const limit = kept ? folderPad + 18 : folderPad
    if (dist > limit && !nextFolders.has(folder.path)) continue
    nextFolders.add(folder.path)
    if (dist <= WALK_FOLDER_LABEL) nextFolderLabels.add(folder.path)
  }

  const nextBridges = new Set<string>()
  for (const bridge of bridges) {
    const dist = bridgeDistance(x, z, bridge)
    const kept = Boolean(prev?.bridges.has(bridge.id))
    const limit = kept ? folderPad + 18 : folderPad
    if (dist <= limit) nextBridges.add(bridge.id)
  }

  return {
    files: nextFiles,
    labels: nextLabels,
    folders: nextFolders,
    folderLabels: nextFolderLabels,
    bridges: nextBridges,
  }
}
