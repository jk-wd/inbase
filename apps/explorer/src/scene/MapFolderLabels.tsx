import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { isBlueprintFolder } from '../layout'
import { BLUEPRINT_OVERLAY, blueprintPalette, type ChangeKind } from '../theme'
import type { PlacedFolder } from '../types'
import { eyeIconMarkup, noteIconMarkup } from '../ui/EyeIcon'
import { createCameraMotion, setLayerMoving } from './mapCameraMotion'
import {
  type MapSheet,
  projectSheets,
  sheetTitlePoint,
  underSheet,
} from './mapLabelOcclusion'
import { mapViewRect, projectToScreen } from './mapProjection'

const MIN_FOLDER_LABEL_PX = 28
const FOLDER_ENTRANCE_Z = 1.35
const LABEL_HEIGHTS = [0, BLUEPRINT_OVERLAY.folderY * BLUEPRINT_OVERLAY.maxStackedLayers]

function folderGitKind(
  folder: PlacedFolder,
  highlightedFolders: Partial<Record<string, ChangeKind>> | undefined,
): ChangeKind | null {
  const kind = highlightedFolders?.[folder.path] ?? null
  if (kind === 'add' && isBlueprintFolder(folder)) return null
  return kind
}

function folderLabelClass(
  folder: PlacedFolder,
  highlightedFolders: Partial<Record<string, ChangeKind>> | undefined,
  selectedFolder: string | null,
  pointed: boolean,
  noted: boolean,
  dimmed: boolean,
) {
  const gitKind = folderGitKind(folder, highlightedFolders)
  return [
    'map-folder-label',
    gitKind
      ? `map-folder-label-${gitKind}`
      : folder.added
        ? 'map-folder-label-added'
        : folder.colorHex
          ? 'map-folder-label-blueprint'
          : '',
    selectedFolder === folder.path ? 'map-folder-label-selected' : '',
    pointed ? 'map-folder-label-pointed' : '',
    noted && !pointed ? 'map-folder-label-noted' : '',
    dimmed ? 'map-folder-label-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const MAX_FOLDER_LABELS = 64

function paintFolderLabel(
  el: HTMLElement,
  folder: PlacedFolder,
  highlightedFolders: Partial<Record<string, ChangeKind>> | undefined,
  selectedFolder: string | null,
  pointed: boolean,
  pointedColors: string[],
  noted: boolean,
  notedColors: string[],
  dimmed: boolean,
  onOpenNote?: (folderPath: string, layer?: string) => void,
) {
  el.className = folderLabelClass(
    folder,
    highlightedFolders,
    selectedFolder,
    pointed,
    noted,
    dimmed,
  )
  el.replaceChildren()
  const sessionColor = pointed
    ? pointedColors[pointedColors.length - 1]
    : noted
      ? notedColors[notedColors.length - 1]
      : undefined
  if (sessionColor) el.style.setProperty('--session-color', sessionColor)
  else el.style.removeProperty('--session-color')
  const gitKind = folderGitKind(folder, highlightedFolders)
  const name = document.createElement('span')
  name.className = 'map-folder-name'
  name.textContent = folderKindLabel(folder.name, gitKind)
  if (folder.colorHex) {
    const tint = blueprintPalette(folder.colorHex)
    el.style.setProperty('--blueprint-color', tint.color)
    el.style.setProperty('--blueprint-label-bg', tint.labelBg)
  } else {
    el.style.removeProperty('--blueprint-color')
    el.style.removeProperty('--blueprint-label-bg')
  }
  el.appendChild(name)
  if (noted) {
    const open = Boolean(onOpenNote) && !folder.path.startsWith('draft:')
    for (const color of notedColors.length > 0 ? notedColors : ['#9ad8ff']) {
      const note = document.createElement(open ? 'button' : 'span')
      note.className = 'map-folder-note'
      note.style.color = color
      note.innerHTML = noteIconMarkup(11)
      if (note instanceof HTMLButtonElement) {
        const label = `Open note for ${folder.name}`
        note.type = 'button'
        note.title = label
        note.setAttribute('aria-label', label)
        note.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
        })
        note.addEventListener('click', (event) => {
          event.stopPropagation()
          event.preventDefault()
          onOpenNote?.(folder.path, el.dataset.layer || undefined)
        })
      }
      el.appendChild(note)
    }
  }
  if (pointed) {
    for (const color of pointedColors.length > 0 ? pointedColors : ['#9ad8ff']) {
      const eye = document.createElement('span')
      eye.className = 'map-folder-eye'
      eye.style.color = color
      eye.innerHTML = eyeIconMarkup(13)
      el.appendChild(eye)
    }
  }
}

export function MapFolderLabels({
  folders,
  highlightedFolders,
  selectedFolder,
  namingFolderPath,
  pointedFolderPaths,
  pointedFolderColors,
  notedFolderPaths,
  notedFolderColors,
  dimmedFolderPaths,
  blueprintOpacity,
  sheets,
  anchors,
  onOpenFolderNote,
  onSelectFolder,
  onBlueprintMenu,
  pickingImport = false,
}: {
  folders: Record<string, PlacedFolder>
  highlightedFolders?: Partial<Record<string, ChangeKind>>
  selectedFolder: string | null
  namingFolderPath: string | null
  pointedFolderPaths: string[]
  pointedFolderColors: Record<string, string[]>
  notedFolderPaths: string[]
  notedFolderColors: Record<string, string[]>
  dimmedFolderPaths: string[]
  blueprintOpacity: number
  sheets: MapSheet[]
  /** Blueprint sheets, so their folder names title the sheet rather than sit on the ground. */
  anchors: Record<string, MapSheet>
  onOpenFolderNote?: (folderPath: string, layer?: string) => void
  onSelectFolder?: (folderPath: string, layer?: string | null) => void
  onBlueprintMenu?: (menu: {
    x: number
    y: number
    folder?: string
    color?: string
  }) => void
  /** Import targeting uses the map under the label, so labels stay click-through. */
  pickingImport?: boolean
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const foldersRef = useRef(folders)
  const highlightedRef = useRef(highlightedFolders)
  const selectedRef = useRef(selectedFolder)
  const namingRef = useRef(namingFolderPath)
  const pointedRef = useRef(pointedFolderPaths)
  const pointedColorsRef = useRef(pointedFolderColors)
  const notedRef = useRef(notedFolderPaths)
  const notedColorsRef = useRef(notedFolderColors)
  const dimmedRef = useRef(dimmedFolderPaths)
  const blueprintOpacityRef = useRef(blueprintOpacity)
  const sheetsRef = useRef(sheets)
  const anchorsRef = useRef(anchors)
  const onOpenFolderNoteRef = useRef(onOpenFolderNote)
  const onSelectFolderRef = useRef(onSelectFolder)
  const onBlueprintMenuRef = useRef(onBlueprintMenu)
  const pickingRef = useRef(pickingImport)
  const isMovingRef = useRef(createCameraMotion())
  sheetsRef.current = sheets
  anchorsRef.current = anchors
  onOpenFolderNoteRef.current = onOpenFolderNote
  onSelectFolderRef.current = onSelectFolder
  onBlueprintMenuRef.current = onBlueprintMenu
  pickingRef.current = pickingImport
  foldersRef.current = folders
  highlightedRef.current = highlightedFolders
  selectedRef.current = selectedFolder
  namingRef.current = namingFolderPath
  pointedRef.current = pointedFolderPaths
  pointedColorsRef.current = pointedFolderColors
  notedRef.current = notedFolderPaths
  notedColorsRef.current = notedFolderColors
  dimmedRef.current = dimmedFolderPaths
  blueprintOpacityRef.current = blueprintOpacity

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const layer = document.createElement('div')
    layer.className = 'map-folder-label-layer'
    layer.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:80;background:transparent;'
    parent.appendChild(layer)
    layerRef.current = layer
    if (pickingRef.current) layer.dataset.picking = 'true'

    const labelFrom = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return null
      const label = target.closest('.map-folder-label')
      if (!(label instanceof HTMLElement)) return null
      if (label.style.visibility === 'hidden' || !label.dataset.path) return null
      return label
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.altKey || event.ctrlKey) return
      const target = event.target
      if (target instanceof Element && target.closest('.map-folder-note')) return
      const label = labelFrom(event)
      const path = label?.dataset.path
      if (!label || !path) return
      onSelectFolderRef.current?.(path, label.dataset.layer || null)
    }
    const onContextMenu = (event: MouseEvent) => {
      const label = labelFrom(event)
      const path = label?.dataset.path
      if (!label || !path) return
      if (event.altKey) {
        event.preventDefault()
        return
      }
      const open = onBlueprintMenuRef.current
      if (!open) return
      event.preventDefault()
      open({
        x: event.clientX,
        y: event.clientY,
        folder: path,
        color: label.dataset.layer || undefined,
      })
    }
    layer.addEventListener('click', onClick)
    layer.addEventListener('contextmenu', onContextMenu)
    return () => {
      layer.removeEventListener('click', onClick)
      layer.removeEventListener('contextmenu', onContextMenu)
      layer.remove()
      layerRef.current = null
    }
  }, [gl])

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    if (pickingImport) layer.dataset.picking = 'true'
    else delete layer.dataset.picking
  }, [pickingImport])

  useFrame(() => {
    const layer = layerRef.current
    if (!layer) return
    const moving = isMovingRef.current(camera, performance.now())
    setLayerMoving(layer, moving)
    if (moving) return
    const items = Object.values(foldersRef.current)
    const highlightedFolders = highlightedRef.current
    const selectedFolder = selectedRef.current
    const namingFolderPath = namingRef.current
    const pointedFolders = new Set(pointedRef.current)
    const pointedFolderColors = pointedColorsRef.current
    const notedFolders = new Set(notedRef.current)
    const notedFolderColors = notedColorsRef.current
    const dimmedFolders = new Set(dimmedRef.current)
    const view = mapViewRect(camera, size.width, size.height, 120, LABEL_HEIGHTS)
    const candidates: {
      folder: PlacedFolder
      x: number
      y: number
      span: number
      pointed: boolean
      noted: boolean
      dimmed: boolean
      rank: number
    }[] = []

    for (let i = 0; i < items.length; i += 1) {
      const folder = items[i]
      if (folder.path === namingFolderPath) continue
      const pointed = pointedFolders.has(folder.path)
      const noted = notedFolders.has(folder.path)
      const dimmed = dimmedFolders.has(folder.path)
      const gitKind = folderGitKind(folder, highlightedFolders)
      const force =
        selectedFolder === folder.path ||
        pointed ||
        noted ||
        Boolean(gitKind || folder.added) ||
        (dimmedFolders.size > 0 && !dimmed)
      const span = Math.max(folder.width, folder.depth) * view.zoom
      if (!force && span < MIN_FOLDER_LABEL_PX) continue
      if (
        folder.x + folder.width / 2 < view.minX ||
        folder.x - folder.width / 2 > view.maxX ||
        folder.z + folder.depth < view.minZ ||
        folder.z > view.maxZ
      ) {
        continue
      }
      const anchor = anchorsRef.current[folder.path]
      const screen = anchor
        ? sheetTitlePoint(anchor, camera, size.width, size.height)
        : projectToScreen(
            folder.x,
            0,
            folder.z + FOLDER_ENTRANCE_Z,
            camera,
            size.width,
            size.height,
          )
      const x = screen.x
      const y = screen.y
      const onScreen =
        !screen.behind &&
        x > -120 &&
        x < size.width + 120 &&
        y > -40 &&
        y < size.height + 40
      if (!onScreen) continue
      candidates.push({
        folder,
        x,
        y,
        span,
        pointed,
        noted,
        dimmed,
        rank:
          selectedFolder === folder.path
            ? 0
            : pointed || noted
              ? 1
              : force
                ? 2
                : 3,
      })
    }

    candidates.sort((a, b) => a.rank - b.rank || b.span - a.span)
    const visible = candidates.slice(0, MAX_FOLDER_LABELS)

    while (layer.children.length < visible.length) {
      const el = document.createElement('div')
      el.className = 'map-folder-label'
      el.style.position = 'absolute'
      el.style.top = '0'
      el.style.left = '0'
      el.style.visibility = 'hidden'
      layer.appendChild(el)
    }

    const cover = projectSheets(
      sheetsRef.current,
      blueprintOpacityRef.current,
      camera,
      size.width,
      size.height,
    )
    const nodes = layer.children
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement
      const next = visible[i]
      if (!next) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        if (el.dataset.path) delete el.dataset.path
        if (el.dataset.layer) delete el.dataset.layer
        continue
      }
      const anchorLayer = anchorsRef.current[next.folder.path]?.layerId
      if (el.dataset.path !== next.folder.path) el.dataset.path = next.folder.path
      if (anchorLayer) {
        if (el.dataset.layer !== anchorLayer) el.dataset.layer = anchorLayer
      } else if (el.dataset.layer) {
        delete el.dataset.layer
      }
      const signature = [
        next.folder.path,
        selectedFolder === next.folder.path ? '1' : '0',
        next.pointed ? '1' : '0',
        next.noted ? '1' : '0',
        next.dimmed ? '1' : '0',
        folderGitKind(next.folder, highlightedFolders) ?? '',
        next.folder.added ? '1' : '0',
        (pointedFolderColors[next.folder.path] ?? []).join(','),
        (notedFolderColors[next.folder.path] ?? []).join(','),
        onOpenFolderNoteRef.current ? '1' : '0',
      ].join('|')
      if (el.dataset.sig !== signature) {
        el.dataset.sig = signature
        paintFolderLabel(
          el,
          next.folder,
          highlightedFolders,
          selectedFolder,
          next.pointed,
          pointedFolderColors[next.folder.path] ?? [],
          next.noted,
          notedFolderColors[next.folder.path] ?? [],
          next.dimmed,
          onOpenFolderNoteRef.current,
        )
      }
      const tx = Math.round(next.x)
      const ty = Math.round(next.y)
      const pos = `${tx},${ty}`
      if (el.dataset.pos !== pos) {
        el.dataset.pos = pos
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(-50%, -50%)`
      }
      const blueprintLabel = Boolean(next.folder.overlay || next.folder.added)
      const behindSheet =
        !blueprintLabel &&
        !anchorsRef.current[next.folder.path] &&
        underSheet(cover, next.x, next.y)
      const labelOpacity = blueprintLabel
        ? blueprintOpacityRef.current
        : behindSheet
          ? cover.throughOpacity
          : 1
      if (el.style.opacity !== String(labelOpacity)) {
        el.style.opacity = String(labelOpacity)
      }
      const zIndex = behindSheet ? '0' : '1'
      if (el.style.zIndex !== zIndex) el.style.zIndex = zIndex
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
    }
  })

  return null
}

function folderKindLabel(name: string, kind: ChangeKind | null | undefined) {
  if (kind === 'remove') return `- ${name}`
  return name
}
