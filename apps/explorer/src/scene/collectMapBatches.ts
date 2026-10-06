import { EXPLAIN_FOCUS, MAP_BRIDGE, blueprintPalette, dimColor, fileColor, folderFloorColor } from '../theme'
import type { FileNode, PlacedBridge, PlacedFile, PlacedFolder } from '../types'
import { mapBridgeLine } from './mapBridgeLine'

const FLOOR_Y = 0
export type MapBoxItem = {
  id: string
  position: [number, number, number]
  size: [number, number, number]
  color: string
  opacity: number
}

export type MapPlaneItem = {
  id: string
  x: number
  z: number
  y: number
  width: number
  depth: number
  color: string
  opacity: number
}

function mapFileInstanceColor(file: FileNode) {
  if (file.colorHex || file.userCreated) return blueprintPalette(file.colorHex).file
  return fileColor(file.language)
}

export function collectMapFileItems(
  files: FileNode[],
  placed: Record<string, PlacedFile>,
  skipIds: Set<string>,
  dimmed: (id: string, folder: string) => boolean,
): MapBoxItem[] {
  const items: MapBoxItem[] = []
  for (const file of files) {
    if (skipIds.has(file.id)) continue
    const block = placed[file.id]
    if (!block) continue
    const faded = dimmed(file.id, file.folder)
    const color = mapFileInstanceColor(file)
    items.push({
      id: file.id,
      position: block.position,
      size: block.size,
      color: faded ? dimColor(color, EXPLAIN_FOCUS.dimColorAmount) : color,
      opacity: faded ? EXPLAIN_FOCUS.dimOpacity : 1,
    })
  }
  return items
}

export function collectMapFolderItems(
  folders: Record<string, PlacedFolder>,
  skipPaths: Set<string>,
  dimmed: (path: string) => boolean,
): MapPlaneItem[] {
  const floors: MapPlaneItem[] = []
  for (const folder of Object.values(folders)) {
    if (skipPaths.has(folder.path)) continue
    const faded = dimmed(folder.path)
    const opacity = faded ? EXPLAIN_FOCUS.dimOpacity : 1
    const z = folder.z + folder.depth / 2
    floors.push({
      id: folder.path,
      x: folder.x,
      z,
      y: FLOOR_Y,
      width: folder.width,
      depth: folder.depth,
      color: folderFloorColor(folder.path),
      opacity,
    })
  }
  return floors
}

export function collectMapBridgeItems(
  bridges: PlacedBridge[],
  dimmed: (id: string) => boolean = () => false,
): MapPlaneItem[] {
  const items: MapPlaneItem[] = []
  for (const bridge of bridges) {
    const opacity = dimmed(bridge.id) ? EXPLAIN_FOCUS.dimOpacity : 1
    for (const piece of mapBridgeLine(bridge)) {
      items.push({
        id: `${bridge.id}:${piece.key}`,
        x: piece.x,
        z: piece.z,
        y: MAP_BRIDGE.y,
        width: piece.width,
        depth: piece.depth,
        color: MAP_BRIDGE.color,
        opacity,
      })
    }
  }
  return items
}
