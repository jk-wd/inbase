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

/** Greys mirror the Cursor Dark Midnight editor theme. Keep in sync with index.css. */
export const EDITOR_GREY = {
  chrome: '#191c22',
  editor: '#1e2127',
  surface: '#272c36',
}

export type ChangeKind = 'add' | 'edit' | 'remove'

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

export const MAP_SELECTION = {
  color: '#000000',
  islandPad: 0.38,
  blockPad: 0.2,
}

export function fileHeight(lines: number) {
  return Math.min(
    CONFIG.maxHeight,
    Math.max(CONFIG.minHeight, lines * CONFIG.heightPerLine),
  )
}

export function fileColor(language: string) {
  switch (language) {
    case 'tsx':
      return '#3f6f9a'
    case 'ts':
      return '#2f6d68'
    case 'jsx':
      return '#7d6aa3'
    case 'js':
    case 'mjs':
    case 'cjs':
      return '#6a5f8f'
    case 'css':
    case 'scss':
      return '#8a5b33'
    case 'json':
      return '#7a6a38'
    case 'html':
      return '#6d4e38'
    default:
      return '#4a5160'
  }
}

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

export function folderFloorColor(path: string) {
  let hash = 0
  for (let i = 0; i < path.length; i += 1) {
    hash = path.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 16%, 18%)`
}
