export const CONFIG = {
  fileWidth: 2.4,
  fileDepth: 2.4,
  heightPerLine: 0.09,
  minHeight: 0.9,
  maxHeight: 12,
  aisleWidth: 8,
  fileSpacing: 5,
  areaPadding: 6,
  bridgeLength: 22,
  bridgeWidth: 3.4,
  bridgeOutset: 5.6,
  bridgeOverlap: 1.15,
  siblingGap: 3.2,
  bridgeDockGap: 1.6,
  eyeHeight: 1.7,
  walkSpeed: 9,
  sprintSpeed: 16,
}

/** Map-mode folder connections: one thick line from folder edge to folder edge. */
export const MAP_BRIDGE = {
  lineWidth: 1.1,
  color: '#3b4757',
  y: 0.02,
}

/** Greys mirror the Cursor Dark Midnight editor theme. Keep in sync with index.css. */
export const EDITOR_GREY = {
  chrome: '#191c22',
  editor: '#1e2127',
  surface: '#272c36',
}

/** Infinite map/walk backdrop. Keep distinct from chrome HUD greys. */
export const WORLD_VOID = '#000000'

export type ChangeKind = 'add' | 'edit' | 'remove'

export const FILE_EMPHASIS_SCALE = 2

export function fileEmphasisScale(
  overlay: boolean,
  changeKind: ChangeKind | null,
  added = false,
) {
  if (overlay) return 1
  if (added || changeKind) return FILE_EMPHASIS_SCALE
  return 1
}

export const CHANGE_HIGHLIGHT: Record<
  ChangeKind,
  { color: string; emissive: string; floor: string; aisle: string }
> = {
  add: {
    color: '#22ff66',
    emissive: '#00e84a',
    floor: '#08351c',
    aisle: '#0f5a2e',
  },
  edit: {
    color: '#2f8cff',
    emissive: '#0066ff',
    floor: '#062448',
    aisle: '#0d3d78',
  },
  remove: {
    color: '#ff2d4a',
    emissive: '#ff1038',
    floor: '#3a0810',
    aisle: '#5c101c',
  },
}

export const FILE_SELECTION = {
  color: '#ffffff',
  emissive: '#ffffff',
  blueprintColor: '#ffffff',
  blueprintEmissive: '#ffffff',
}

export const MAP_SELECTION = {
  color: '#ffffff',
  island: '#ffffff',
  islandPad: 0.38,
  blockPad: 0.1,
  pointed: '#9ad8ff',
  pointedPad: 0.22,
  explain: '#9ad8ff',
  explainPad: 0.16,
}

/** How strongly /explainit mode recedes everything outside the focused island. */
export const EXPLAIN_FOCUS = {
  dimOpacity: 0.18,
  dimColorAmount: 0.5,
}

export function explainItemOpacity(dimmed: boolean, base = 1) {
  return dimmed ? base * EXPLAIN_FOCUS.dimOpacity : base
}

/** Blueprint islands and bridges stay see-through. Full strength is 75%. */
export const MAP_PIECE_OPACITY = 0.75

export function capMapPieceOpacity(opacity: number) {
  return Math.min(opacity, MAP_PIECE_OPACITY)
}

/** Map camera limits. Tilt 0 is the classic straight-down map. */
export const MAP_VIEW = {
  maxTiltDeg: 62,
  rotateSpeed: 0.6,
  resetMs: 700,
  /** Labels stay hidden until the camera has been still this long. */
  labelSettleMs: 160,
}

/**
 * Brightness per map block face. The top stays at 1 so the straight-down map
 * keeps its colors; darker sides make heights readable once the map is tilted.
 */
export const MAP_BLOCK_SHADE = {
  top: 1,
  west: 0.82,
  south: 0.7,
  north: 0.62,
  east: 0.56,
  bottom: 0.4,
}

export function fileHeight(lines: number) {
  return Math.min(
    CONFIG.maxHeight,
    Math.max(CONFIG.minHeight, lines * CONFIG.heightPerLine),
  )
}

export {
  DEFAULT_FILE_COLOR,
  FILE_COLORS,
  fileColor,
} from './file-colors'

export function dimColor(hex: string, amount = 0.32) {
  const value = hex.replace('#', '')
  if (value.length !== 6) return hex
  const mix = Math.max(0, Math.min(1, amount))
  const channel = (start: number) => {
    const n = parseInt(value.slice(start, start + 2), 16)
    return Math.round(n * (1 - mix))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

export function lightenColor(hex: string, amount = 0.35) {
  const value = hex.replace('#', '')
  if (value.length !== 6) return hex
  const mix = Math.max(0, Math.min(1, amount))
  const channel = (start: number) => {
    const n = parseInt(value.slice(start, start + 2), 16)
    return Math.round(n + (255 - n) * mix)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

export const BLUEPRINT_OVERLAY = {
  /** Fill opacity of every blueprint folder sheet, so the map reads through. */
  folderOpacity: 0.55,
  folderOutlineOpacity: 0.7,
  fileOpacity: 0.96,
  /** Lift of the first raised blueprint; each further raised color stacks one more lift up. */
  folderY: 1.2,
  /** Raised blueprint floors that view culling makes room for. */
  maxStackedLayers: 6,
  fileLift: 0.35,
  /** Blueprint-only folders have nothing underneath, so they lie on the ground. */
  groundY: 0.03,
  groundLayerStep: 0.015,
  groundFileLift: 0.02,
  /** Real files under a shown blueprint folder render as flat tiles. */
  coveredFileHeight: 0.08,
  strength: 1,
}

export function blueprintPalette(hex?: string | null) {
  const color =
    typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#38bdf8'
  return {
    color,
    wash: lightenColor(color, 0.22),
    block: dimColor(color, 0.88),
    label: lightenColor(color, 0.42),
    labelBg: dimColor(color, 0.78),
    emissive: dimColor(color, 0.45),
    floor: dimColor(color, 0.78),
    aisle: dimColor(color, 0.58),
    /** File blocks on a blueprint: the blueprint color, darkened. */
    file: dimColor(color, 0.68),
  }
}

function folderHue(path: string) {
  let hash = 0
  for (let i = 0; i < path.length; i += 1) {
    hash = path.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

export function folderFloorColor(path: string) {
  return `hsl(${folderHue(path)}, 5%, 48%)`
}

export function folderAisleColor(path: string) {
  return `hsl(${folderHue(path)}, 6%, 40%)`
}
