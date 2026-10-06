import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BLUEPRINT_OVERLAY, CONFIG, blueprintPalette } from '../theme'
import { mapMarkIconWorld, mapMarkOffsetX, mapMarkRowWidth } from '../ui/EyeIcon'
import { createCameraMotion, setLayerMoving } from './mapCameraMotion'
import { type MapSheet, type SheetCover, projectSheets, underSheet } from './mapLabelOcclusion'
import { mapViewRect, projectFootprint } from './mapProjection'

export type MapFileLabel = {
  id: string
  name: string
  x: number
  /** Top of the block, so tilted labels stay attached to what they name. */
  y: number
  z: number
  width: number
  depth: number
  outer: 1 | -1
  selected: boolean
  pointed: boolean
  pointedColor?: string
  noted?: boolean
  notedColor?: string
  notedColors?: string[]
  pointedColors?: string[]
  dimmed?: boolean
  focused?: boolean
  blueprintHex?: string
  overlay?: boolean
}

const LABEL_HEIGHTS = [
  0,
  BLUEPRINT_OVERLAY.folderY * BLUEPRINT_OVERLAY.maxStackedLayers + CONFIG.maxHeight,
]
const MIN_FILE_LABEL_PX = 16
const FILE_LABEL_HEIGHT = 15
const FILE_LABEL_GAP = 4
const FILE_LABEL_STACK_MAX = 3
const FILE_LABEL_STACK_GAP = 2
const MAX_FILE_LABELS = 28
const FILE_LABEL_CHAR_W = 7.2
const FILE_LABEL_PAD_X = 12
const FILE_LABEL_MIN_W = 108
const FILE_LABEL_MAX_W = 220
const FILE_LABEL_BLOCK_SCALE = 5.2
const MARK_CLEAR_PX = 6
const FILE_LABEL_LEADER_BLOCK_PX = 80
const FILE_LABEL_LEADER_SHIFT_PX = 14
const FILE_LABEL_LEADER_MIN_PX = 18

function markScreenSpan(file: MapFileLabel, zoom: number) {
  const notes = file.noted ? Math.max(file.notedColors?.length ?? 1, 1) : 0
  const eyes = file.pointed ? Math.max(file.pointedColors?.length ?? 1, 1) : 0
  const count = notes + eyes
  if (count === 0) return null
  const iconWorld = mapMarkIconWorld(Math.min(file.width, file.depth), zoom)
  const half = (mapMarkRowWidth(iconWorld, count) * zoom) / 2
  const center = mapMarkOffsetX(file.width, file.depth, count, zoom) * zoom
  return { left: center - half, right: center + half }
}

function labelHitsMark(
  file: MapFileLabel,
  zoom: number,
  screenX: number,
  edgeX: number,
  labelW: number,
  outer: 1 | -1 | 0,
) {
  const span = markScreenSpan(file, zoom)
  if (!span) return false
  const box = fileLabelBounds(edgeX, 0, labelW, outer)
  return box.r > screenX + span.left - MARK_CLEAR_PX && box.l < screenX + span.right + MARK_CLEAR_PX
}

function fileLabelClass(file: MapFileLabel) {
  return [
    'map-file-label',
    file.selected ? 'map-file-label-selected' : '',
    file.pointed ? 'map-file-label-pointed' : '',
    file.noted && !file.pointed ? 'map-file-label-noted' : '',
    file.focused ? 'map-file-label-focused' : '',
    file.dimmed ? 'map-file-label-dimmed' : '',
    file.blueprintHex ? 'map-file-label-blueprint' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function fileNoteColors(file: MapFileLabel) {
  if (file.notedColors && file.notedColors.length > 0) return file.notedColors
  if (file.notedColor) return [file.notedColor]
  return ['#9ad8ff']
}

function paintFileLabel(el: HTMLElement, file: MapFileLabel) {
  el.replaceChildren()
  const name = document.createElement('span')
  name.className = 'map-file-name'
  name.textContent = file.name
  el.appendChild(name)
}

type FileLabelCandidate = {
  file: MapFileLabel
  x: number
  y: number
  w: number
  outer: 1 | -1 | 0
  rank: number
  dist: number
  anchorX: number
  anchorY: number
  halfW: number
  halfH: number
}

type FileLabelLeader = { x1: number; y1: number; x2: number; y2: number }

type FileLabelBox = { l: number; t: number; r: number; b: number }

function fileLabelBounds(
  x: number,
  y: number,
  w: number,
  outer: 1 | -1 | 0,
): FileLabelBox {
  const left = outer === 1 ? x : outer === -1 ? x - w : x - w / 2
  const right = outer === 1 ? x + w : outer === -1 ? x : x + w / 2
  return {
    l: left,
    t: y - FILE_LABEL_HEIGHT / 2,
    r: right,
    b: y + FILE_LABEL_HEIGHT / 2,
  }
}

function labelsOverlap(
  left: number,
  top: number,
  right: number,
  bottom: number,
  placed: FileLabelBox[],
) {
  for (let i = 0; i < placed.length; i += 1) {
    const box = placed[i]
    if (left < box.r && right > box.l && top < box.b && bottom > box.t) return true
  }
  return false
}

function fileLabelLeader(item: FileLabelCandidate): FileLabelLeader | null {
  const labelX = Math.round(item.x)
  const labelY = Math.round(item.y)
  const labelW = Math.round(item.w)
  const box = fileLabelBounds(labelX, labelY, labelW, item.outer)
  const blockL = item.anchorX - item.halfW
  const blockT = item.anchorY - item.halfH
  const blockR = item.anchorX + item.halfW
  const blockB = item.anchorY + item.halfH
  const offBlock =
    box.r < blockL + 1 ||
    box.l > blockR - 1 ||
    box.b < blockT + 1 ||
    box.t > blockB - 1
  if (!offBlock) return null
  const blockPx = Math.min(item.halfW, item.halfH) * 2
  const shifted = Math.abs(labelY - item.anchorY) >= FILE_LABEL_LEADER_SHIFT_PX
  if (blockPx < FILE_LABEL_LEADER_BLOCK_PX && !shifted) return null

  const y1 = (box.t + box.b) / 2
  const x1 = item.outer === 1 ? box.l : item.outer === -1 ? box.r : item.anchorX
  const yStart =
    item.outer === 0 ? Math.min(box.b, Math.max(box.t, item.anchorY)) : y1
  const xStart =
    item.outer === 0 ? Math.min(box.r, Math.max(box.l, item.anchorX)) : x1
  const x2 = Math.round(item.anchorX)
  const y2 = Math.round(item.anchorY)
  const startX = Math.round(xStart)
  const startY = Math.round(yStart)
  if (Math.hypot(x2 - startX, y2 - startY) < FILE_LABEL_LEADER_MIN_PX) return null
  return { x1: startX, y1: startY, x2, y2 }
}

function boxesOverlap(a: FileLabelBox, b: FileLabelBox, pad: number) {
  return (
    a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad
  )
}

function pickStackedFileLabels(candidates: FileLabelCandidate[], limit: number) {
  const n = candidates.length
  if (n === 0 || limit <= 0) return [] as FileLabelCandidate[]

  const boxes = candidates.map((item) =>
    fileLabelBounds(item.x, item.y, item.w, item.outer),
  )
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number) => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    let current = i
    while (parent[current] !== root) {
      const next = parent[current]
      parent[current] = root
      current = next
    }
    return root
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j], 2)) unite(i, j)
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(i)
    else groups.set(root, [i])
  }

  const clusters = [...groups.values()].map((idxs) => {
    const items = idxs.map((i) => candidates[i])
    items.sort((a, b) => a.rank - b.rank || a.dist - b.dist)
    return items
  })
  clusters.sort((a, b) => a[0].rank - b[0].rank || a[0].dist - b[0].dist)

  const placed: FileLabelBox[] = []
  const visible: FileLabelCandidate[] = []
  const pitch = FILE_LABEL_HEIGHT + FILE_LABEL_STACK_GAP

  for (let c = 0; c < clusters.length && visible.length < limit; c += 1) {
    const cluster = clusters[c]
    let take = Math.min(FILE_LABEL_STACK_MAX, cluster.length, limit - visible.length)
    while (take > 0) {
      const chosen = cluster.slice(0, take).sort((a, b) => a.y - b.y || a.dist - b.dist)
      const centerY = chosen.reduce((sum, item) => sum + item.y, 0) / chosen.length
      const startY = centerY - ((chosen.length - 1) * pitch) / 2
      const stacked = chosen.map((item, i) => ({
        ...item,
        y: startY + i * pitch,
      }))
      const stackBoxes = stacked.map((item) =>
        fileLabelBounds(item.x, item.y, item.w, item.outer),
      )
      const collides = stackBoxes.some((box) =>
        labelsOverlap(box.l, box.t - 2, box.r, box.b + 2, placed),
      )
      if (!collides) {
        placed.push(...stackBoxes)
        visible.push(...stacked)
        break
      }
      take -= 1
    }
  }

  return visible
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function createFileLabelLeader() {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'map-file-label-leader')
  group.style.visibility = 'hidden'
  const halo = document.createElementNS(SVG_NS, 'line')
  halo.setAttribute('class', 'map-file-label-leader-halo')
  const line = document.createElementNS(SVG_NS, 'line')
  line.setAttribute('class', 'map-file-label-leader-line')
  const dot = document.createElementNS(SVG_NS, 'circle')
  dot.setAttribute('class', 'map-file-label-leader-dot')
  dot.setAttribute('r', '2.4')
  group.append(halo, line, dot)
  return group
}

/** Real map files (even pointed or noted ones) lie under the sheet; only blueprint blocks sit on it. */
function onBlueprint(file: MapFileLabel) {
  return Boolean(file.overlay || file.selected)
}

function fileLabelOpacity(
  item: FileLabelCandidate,
  blueprintOpacity: number,
  cover: SheetCover,
) {
  if (item.file.overlay) return blueprintOpacity
  if (onBlueprint(item.file)) return 1
  const box = fileLabelBounds(item.x, item.y, item.w, item.outer)
  return underSheet(cover, (box.l + box.r) / 2, item.y) ? cover.throughOpacity : 1
}

function paintFileLabelLeaders(
  svg: SVGSVGElement,
  visible: FileLabelCandidate[],
  opacities: number[],
) {
  const leaders: FileLabelLeader[] = []
  const dimmed: boolean[] = []
  const layerOpacity: number[] = []
  for (let i = 0; i < visible.length; i += 1) {
    const leader = fileLabelLeader(visible[i])
    if (!leader) continue
    leaders.push(leader)
    dimmed.push(Boolean(visible[i].file.dimmed))
    layerOpacity.push(opacities[i])
  }

  while (svg.childElementCount < leaders.length) {
    svg.appendChild(createFileLabelLeader())
  }

  const nodes = svg.children
  for (let i = 0; i < nodes.length; i += 1) {
    const group = nodes[i] as SVGGElement
    const leader = leaders[i]
    if (!leader) {
      if (group.style.visibility !== 'hidden') group.style.visibility = 'hidden'
      continue
    }
    const signature = `${leader.x1},${leader.y1},${leader.x2},${leader.y2},${dimmed[i] ? 1 : 0},${layerOpacity[i]}`
    if (group.dataset.sig !== signature) {
      group.dataset.sig = signature
      const halo = group.children[0]
      const line = group.children[1]
      const dot = group.children[2]
      for (const el of [halo, line]) {
        el.setAttribute('x1', String(leader.x1))
        el.setAttribute('y1', String(leader.y1))
        el.setAttribute('x2', String(leader.x2))
        el.setAttribute('y2', String(leader.y2))
      }
      dot.setAttribute('cx', String(leader.x2))
      dot.setAttribute('cy', String(leader.y2))
      group.classList.toggle('map-file-label-leader-dimmed', dimmed[i])
    }
    const opacity = String(layerOpacity[i] ?? 1)
    if (group.style.opacity !== opacity) group.style.opacity = opacity
    if (group.style.visibility !== 'visible') group.style.visibility = 'visible'
  }
}

export function MapFileLabels({
  files,
  namingFileId,
  blueprintOpacity,
  sheets,
}: {
  files: MapFileLabel[]
  namingFileId: string | null
  blueprintOpacity: number
  sheets: MapSheet[]
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const leadersRef = useRef<SVGSVGElement | null>(null)
  const filesRef = useRef(files)
  const namingRef = useRef(namingFileId)
  const blueprintOpacityRef = useRef(blueprintOpacity)
  const sheetsRef = useRef(sheets)
  const isMovingRef = useRef(createCameraMotion())
  filesRef.current = files
  namingRef.current = namingFileId
  blueprintOpacityRef.current = blueprintOpacity
  sheetsRef.current = sheets

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const layer = document.createElement('div')
    layer.className = 'map-file-label-layer'
    layer.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:70;background:transparent;'
    const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    leaders.setAttribute('class', 'map-file-label-leaders')
    layer.appendChild(leaders)
    parent.appendChild(layer)
    layerRef.current = layer
    leadersRef.current = leaders
    return () => {
      layer.remove()
      layerRef.current = null
      leadersRef.current = null
    }
  }, [gl])

  useFrame(() => {
    const layer = layerRef.current
    const leaders = leadersRef.current
    const items = filesRef.current
    if (!layer || !leaders) return
    const moving = isMovingRef.current(camera, performance.now())
    setLayerMoving(layer, moving)
    if (moving) return
    const view = mapViewRect(camera, size.width, size.height, 80, LABEL_HEIGHTS)
    const zoom = view.zoom
    const cx = size.width * 0.5
    const cy = size.height * 0.5
    const candidates: FileLabelCandidate[] = []

    for (let i = 0; i < items.length; i += 1) {
      const file = items[i]
      if (file.id === namingRef.current) continue
      const block = Math.min(file.width, file.depth) * zoom
      const force = file.selected || file.pointed || file.noted || file.focused || Boolean(file.overlay)
      if (!force && block < MIN_FILE_LABEL_PX) continue
      if (
        file.x < view.minX ||
        file.x > view.maxX ||
        file.z < view.minZ ||
        file.z > view.maxZ
      ) {
        continue
      }
      const screen = projectFootprint(
        file.x,
        file.y,
        file.z,
        file.width,
        file.depth,
        camera,
        size.width,
        size.height,
      )
      if (
        screen.behind ||
        screen.x < -80 ||
        screen.x > size.width + 80 ||
        screen.y < -40 ||
        screen.y > size.height + 40
      ) {
        continue
      }
      const maxWidth = Math.max(
        FILE_LABEL_MIN_W,
        Math.min(FILE_LABEL_MAX_W, block * FILE_LABEL_BLOCK_SCALE),
      )
      const width = Math.min(
        maxWidth,
        file.name.length * FILE_LABEL_CHAR_W + FILE_LABEL_PAD_X,
      )
      const onBlock = block >= 48 && width <= block * 0.9
      const { halfW, halfH } = screen
      let outer: 1 | -1 | 0 = onBlock ? 0 : file.outer
      let edgeX = onBlock ? screen.x : screen.x + file.outer * (halfW + FILE_LABEL_GAP)
      if (labelHitsMark(file, zoom, screen.x, edgeX, width, outer)) {
        outer = -1
        edgeX = screen.x - (halfW + FILE_LABEL_GAP)
      }
      candidates.push({
        file,
        x: edgeX,
        y: screen.y,
        w: width,
        outer,
        rank: file.selected ? 0 : file.pointed || file.noted || file.focused ? 1 : 2,
        dist: Math.hypot(screen.x - cx, screen.y - cy),
        anchorX: screen.x,
        anchorY: screen.y,
        halfW,
        halfH,
      })
    }

    const visible = pickStackedFileLabels(candidates, MAX_FILE_LABELS)
    const cover = projectSheets(
      sheetsRef.current,
      blueprintOpacityRef.current,
      camera,
      size.width,
      size.height,
    )
    const opacities = visible.map((item) =>
      fileLabelOpacity(item, blueprintOpacityRef.current, cover),
    )
    paintFileLabelLeaders(leaders, visible, opacities)

    while (layer.children.length - 1 < visible.length) {
      const el = document.createElement('div')
      el.className = 'map-file-label'
      el.style.position = 'absolute'
      el.style.top = '0'
      el.style.left = '0'
      el.style.visibility = 'hidden'
      layer.appendChild(el)
    }

    const nodes = layer.children
    for (let i = 1; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement
      const next = visible[i - 1]
      if (!next) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      const className = fileLabelClass(next.file)
      if (el.className !== className) el.className = className
      if (el.dataset.id !== next.file.id) {
        el.dataset.id = next.file.id
      }
      if (next.file.pointed && next.file.pointedColor) {
        el.style.setProperty('--session-color', next.file.pointedColor)
      } else if (next.file.noted && next.file.notedColor) {
        el.style.setProperty('--session-color', next.file.notedColor)
      } else {
        el.style.removeProperty('--session-color')
      }
      if (next.file.blueprintHex) {
        const tint = blueprintPalette(next.file.blueprintHex)
        el.style.setProperty('--blueprint-color', tint.color)
        el.style.setProperty('--blueprint-label-bg', tint.labelBg)
      } else {
        el.style.removeProperty('--blueprint-color')
        el.style.removeProperty('--blueprint-label-bg')
      }
      const content = [
        next.file.id,
        next.file.name,
        next.file.noted ? '1' : '0',
        next.file.noted ? fileNoteColors(next.file).join(',') : '',
      ].join('|')
      if (el.dataset.content !== content) {
        el.dataset.content = content
        paintFileLabel(el, next.file)
      }
      el.style.maxWidth = `${Math.round(next.w)}px`
      el.style.justifyContent =
        next.outer === 1 ? 'flex-start' : next.outer === -1 ? 'flex-end' : 'center'
      el.style.textAlign =
        next.outer === 1 ? 'left' : next.outer === -1 ? 'right' : 'center'
      const tx = Math.round(next.x)
      const ty = Math.round(next.y)
      const pos = `${tx},${ty},${next.outer}`
      const origin =
        next.outer === 1 ? '0, -50%' : next.outer === -1 ? '-100%, -50%' : '-50%, -50%'
      if (el.dataset.pos !== pos) {
        el.dataset.pos = pos
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(${origin})`
      }
      const labelOpacity = opacities[i - 1]
      if (el.style.opacity !== String(labelOpacity)) {
        el.style.opacity = String(labelOpacity)
      }
      const behindSheet = !onBlueprint(next.file) && labelOpacity < 1 ? '0' : '1'
      if (el.style.zIndex !== behindSheet) el.style.zIndex = behindSheet
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
    }
  })

  return null
}
