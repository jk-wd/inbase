import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, MapControls, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { folderAt, isBlueprintFolder, worldBounds } from '../layout'
import type { ChangeKind } from '../theme'
import { blueprintPalette } from '../theme'
import type { PlacedFolder, WorldLayout } from '../types'
import { eyeIconMarkup } from '../ui/EyeIcon'

export type MapBlueprintMenu = {
  x: number
  y: number
  folder: string
  color?: string
}

export type MapFileLabel = {
  id: string
  name: string
  x: number
  z: number
  width: number
  depth: number
  outer: 1 | -1
  selected: boolean
  pointed: boolean
  pointedColor?: string
  dimmed?: boolean
  focused?: boolean
  blueprintHex?: string
  overlay?: boolean
}

export type MapFocusBounds = {
  cx: number
  cz: number
  width: number
  depth: number
}

type MapPose = {
  cx: number
  cz: number
  width: number
  depth: number
}

type MapFlight = {
  from: MapPose
  via: MapPose
  to: MapPose
  start: number
  duration: number
  split: number
}

const FOCUS_FLY_IN_MS = 900
const FOCUS_FLY_OUT_IN_MS = 1500
const FOCUS_FLY_SPLIT = 0.4

function mapFolderFromHit(hit: THREE.Intersection): {
  path: string
  layer?: string
} | null {
  const fromObject = mapFolderFromObject(hit.object)
  if (fromObject) return fromObject
  if (typeof hit.instanceId !== 'number') return null
  const paths = hit.object.userData?.mapFolderPaths
  if (!Array.isArray(paths)) return null
  const path = paths[hit.instanceId]
  return typeof path === 'string' && path ? { path } : null
}

function fileIdFromHit(hit: THREE.Intersection): string | null {
  const fileId = hit.object.userData?.fileId
  if (typeof fileId === 'string' && fileId) return fileId
  if (typeof hit.instanceId !== 'number') return null
  const ids = hit.object.userData?.mapFileIds
  if (!Array.isArray(ids)) return null
  const id = ids[hit.instanceId]
  return typeof id === 'string' && id ? id : null
}

function mapFolderFromObject(object: THREE.Object3D): {
  path: string
  layer?: string
} | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const path = current.userData?.mapFolderPath
    if (typeof path === 'string' && path) {
      const layer = current.userData?.mapFolderLayer
      return {
        path,
        layer: typeof layer === 'string' && layer ? layer : undefined,
      }
    }
    current = current.parent
  }
  return null
}

function poseOf(bounds: MapPose): MapPose {
  return { cx: bounds.cx, cz: bounds.cz, width: bounds.width, depth: bounds.depth }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function lerpPose(a: MapPose, b: MapPose, t: number): MapPose {
  return {
    cx: lerp(a.cx, b.cx, t),
    cz: lerp(a.cz, b.cz, t),
    width: lerp(a.width, b.width, t),
    depth: lerp(a.depth, b.depth, t),
  }
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function flightPose(flight: MapFlight, now: number) {
  const t = Math.min(1, (now - flight.start) / flight.duration)
  const pose =
    flight.split <= 0
      ? lerpPose(flight.from, flight.to, easeInOutCubic(t))
      : t < flight.split
        ? lerpPose(flight.from, flight.via, easeInOutCubic(t / flight.split))
        : lerpPose(
            flight.via,
            flight.to,
            easeInOutCubic((t - flight.split) / (1 - flight.split)),
          )
  return { t, pose }
}

function applyMapPose(
  camera: THREE.OrthographicCamera,
  pose: MapPose,
  viewWidth: number,
  viewHeight: number,
  hudReserve: number,
  controls: { target: THREE.Vector3; update: () => void } | null,
) {
  const fitZoom = Math.min(
    viewWidth / Math.max(pose.width + 36, 1),
    viewHeight / Math.max(pose.depth + 36, 1),
  )
  const zoom = Math.max(fitZoom * 0.92, 0.08)
  const cz = pose.cz + hudReserve / 2 / zoom
  camera.up.set(0, 0, -1)
  camera.position.set(pose.cx, 120, cz)
  camera.lookAt(pose.cx, 0, cz)
  camera.near = 1
  camera.far = 2000
  camera.zoom = zoom
  camera.updateProjectionMatrix()
  if (controls) {
    controls.target.set(pose.cx, 0, cz)
    controls.update()
  }
}

type MapViewProps = {
  layout: WorldLayout
  fitLayout?: WorldLayout
  enabled: boolean
  marker: [number, number] | null
  highlightedFolders?: Partial<Record<string, ChangeKind>>
  selectedFolder?: string | null
  namingFolderPath?: string | null
  namingFileId?: string | null
  pointedFolderPaths?: string[]
  pointedFolderColors?: Record<string, string[]>
  fileLabels?: MapFileLabel[]
  focusBounds?: MapFocusBounds | null
  focusFlightKey?: string | number
  hudReserve?: number
  topReserve?: number
  landEnabled?: boolean
  dimmedFolderPaths?: string[]
  onLand: (x: number, z: number) => void
  onSelect: (fileId: string | null) => void
  onSelectFolder: (folderPath: string | null, layer?: string | null) => void
  pickingImport?: boolean
  onBlueprintMenu?: (menu: MapBlueprintMenu) => void
}

export function MapView({
  layout,
  fitLayout = layout,
  enabled,
  marker,
  highlightedFolders,
  selectedFolder = null,
  namingFolderPath = null,
  namingFileId = null,
  pointedFolderPaths = [],
  pointedFolderColors = {},
  fileLabels = [],
  focusBounds = null,
  focusFlightKey = 0,
  hudReserve = 88,
  topReserve = 28,
  landEnabled = true,
  dimmedFolderPaths = [],
  onLand,
  onSelect,
  onSelectFolder,
  onBlueprintMenu,
  pickingImport = false,
}: MapViewProps) {
  const size = useThree((state) => state.size)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const scene = useThree((state) => state.scene)
  const world = useMemo(() => worldBounds(fitLayout), [fitLayout])
  const focusing = Boolean(focusBounds)
  const bounds = focusBounds ?? world
  const drag = useRef({ x: 0, y: 0, moved: false, active: false })
  const sized = size.width > 16 && size.height > 16
  const viewWidth = Math.max(size.width, 1)
  const viewHeight = Math.max(size.height - hudReserve - topReserve, 1)

  const fitZoom = sized
    ? Math.min(
        viewWidth / Math.max(bounds.width + 36, 1),
        viewHeight / Math.max(bounds.depth + 36, 1),
      )
    : 8
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void }>(null)
  const poseRef = useRef<MapPose>(poseOf(bounds))
  const flightRef = useRef<MapFlight | null>(null)
  const flightKeyRef = useRef<number | string | null>(null)
  const focusingRef = useRef(false)
  const fittedRef = useRef(false)
  const [flying, setFlying] = useState(false)

  const snapTo = (pose: MapPose) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return
    flightRef.current = null
    poseRef.current = pose
    applyMapPose(
      camera,
      pose,
      viewWidth,
      viewHeight,
      hudReserve,
      controlsRef.current,
    )
    setFlying(false)
    invalidate()
  }

  useLayoutEffect(() => {
    if (!enabled) {
      fittedRef.current = false
      return
    }
    if (!(camera instanceof THREE.OrthographicCamera)) return
    const target = poseOf(bounds)
    const key = focusing ? focusFlightKey : 'map'
    const wasFocusing = focusingRef.current
    const prevKey = flightKeyRef.current
    focusingRef.current = focusing
    flightKeyRef.current = key

    if (!sized) {
      snapTo(target)
      return
    }

    if (focusing && prevKey !== null && prevKey !== key) {
      flightRef.current = {
        from: poseRef.current,
        via: wasFocusing ? poseOf(world) : poseRef.current,
        to: target,
        start: performance.now(),
        duration: wasFocusing ? FOCUS_FLY_OUT_IN_MS : FOCUS_FLY_IN_MS,
        split: wasFocusing ? FOCUS_FLY_SPLIT : 0,
      }
      setFlying(true)
      invalidate()
      return
    }

    if (flightRef.current) return

    if (focusing) {
      snapTo(target)
      fittedRef.current = true
      return
    }

    if (!fittedRef.current || prevKey !== 'map') {
      snapTo(target)
      fittedRef.current = true
      return
    }

    applyMapPose(
      camera,
      poseRef.current,
      viewWidth,
      viewHeight,
      hudReserve,
      controlsRef.current,
    )
    invalidate()
  }, [
    bounds.cx,
    bounds.cz,
    bounds.depth,
    bounds.width,
    camera,
    enabled,
    focusFlightKey,
    focusing,
    hudReserve,
    invalidate,
    sized,
    viewHeight,
    viewWidth,
    world.cx,
    world.cz,
    world.depth,
    world.width,
  ])

  useFrame(() => {
    const flight = flightRef.current
    if (!flight || !enabled || !(camera instanceof THREE.OrthographicCamera)) return
    const { t, pose } = flightPose(flight, performance.now())
    poseRef.current = pose
    applyMapPose(
      camera,
      pose,
      viewWidth,
      viewHeight,
      hudReserve,
      controlsRef.current,
    )
    if (t < 1) return
    flightRef.current = null
    poseRef.current = flight.to
    applyMapPose(
      camera,
      flight.to,
      viewWidth,
      viewHeight,
      hudReserve,
      controlsRef.current,
    )
    setFlying(false)
  })

  useEffect(() => {
    if (!enabled) return
    const element = gl.domElement
    const restCursor = pickingImport ? 'crosshair' : 'grab'
    element.style.cursor = restCursor

    const isWalkClick = (event: PointerEvent | MouseEvent) =>
      landEnabled && event.altKey

    const isWalkButton = (event: PointerEvent) => event.button === 0

    const onDown = (event: PointerEvent) => {
      if (!isWalkButton(event)) return
      drag.current = { x: event.clientX, y: event.clientY, moved: false, active: true }
      element.style.cursor = 'grabbing'
    }

    const onMove = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 5) {
        drag.current.moved = true
      }
    }

    const pickAt = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return null
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(scene.children, true)
      const relationHit = hits.find((hit) => hit.object.userData.relationTo)
      let fileId: string | null = null
      let folderPick: { path: string; layer?: string } | null = null
      for (const hit of hits) {
        if (!fileId) fileId = fileIdFromHit(hit)
        if (!folderPick) folderPick = mapFolderFromHit(hit)
        if (fileId && folderPick) break
      }
      return { raycaster, relationHit, fileId, folderPick }
    }

    const landAt = (x: number, z: number) => {
      const lock = element.requestPointerLock()
      if (lock && typeof lock.catch === 'function') {
        void lock.catch(() => {})
      }
      onLand(x, z)
    }

    const landAtPointer = (clientX: number, clientY: number, allowIsland: boolean) => {
      const pick = pickAt(clientX, clientY)
      if (!pick) return false
      const { raycaster, relationHit, fileId } = pick
      if (fileId) return false

      const hit = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      if (!raycaster.ray.intersectPlane(plane, hit)) return false

      const folder = folderAt(hit.x, hit.z, layout)
      if (allowIsland && folder) {
        landAt(hit.x, hit.z)
        return true
      }
      if (relationHit) return false

      landAt(hit.x, hit.z)
      return true
    }

    const onUp = (event: PointerEvent) => {
      element.style.cursor = restCursor
      const startedOnCanvas = drag.current.active
      drag.current.active = false
      if (!startedOnCanvas || !isWalkButton(event) || drag.current.moved) return

      if (
        !pickingImport &&
        isWalkClick(event) &&
        landAtPointer(event.clientX, event.clientY, true)
      ) {
        return
      }

      const pick = pickAt(event.clientX, event.clientY)
      if (!pick) return
      const { fileId } = pick
      if (fileId) {
        onSelect(fileId)
        return
      }

      if (pickingImport) return

      if (pick.folderPick) {
        onSelectFolder(pick.folderPick.path, pick.folderPick.layer ?? null)
        return
      }

      const hit = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      if (pick.raycaster.ray.intersectPlane(plane, hit)) {
        const folder = folderAt(hit.x, hit.z, layout)
        if (folder) {
          onSelectFolder(folder.path, null)
          return
        }
      }
      onSelect(null)
      onSelectFolder(null)
    }

    const onContextMenu = (event: MouseEvent) => {
      if (event.altKey) {
        event.preventDefault()
        return
      }
      if (!onBlueprintMenu) return
      event.preventDefault()
      const pick = pickAt(event.clientX, event.clientY)
      if (!pick) return
      const hit = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const planeHit = pick.raycaster.ray.intersectPlane(plane, hit)
      const groundFolder = planeHit ? folderAt(hit.x, hit.z, layout) : null
      const folderPath =
        pick.folderPick?.path ??
        groundFolder?.path ??
        selectedFolder ??
        layout.folders['.']?.path
      if (!folderPath) return
      onSelectFolder(folderPath, pick.folderPick?.layer ?? null)
      onBlueprintMenu({
        x: event.clientX,
        y: event.clientY,
        folder: folderPath,
        color: pick.folderPick?.layer,
      })
    }

    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const ndc = new THREE.Vector2()
    const before = new THREE.Vector3()
    const after = new THREE.Vector3()
    const raycaster = new THREE.Raycaster()
    const minZoom = Math.max(fitZoom * 0.35, 0.05)
    const maxZoom = Math.max(fitZoom * 10, 20)
    const zoomScale = Math.pow(0.95, 1.15)

    const worldUnderCursor = (clientX: number, clientY: number, target: THREE.Vector3) => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return false
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      return Boolean(raycaster.ray.intersectPlane(ground, target))
    }

    const zoomAtCursor = (clientX: number, clientY: number, dollyScale: number) => {
      if (!(camera instanceof THREE.OrthographicCamera)) return
      if (!worldUnderCursor(clientX, clientY, before)) return
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom / dollyScale))
      if (nextZoom === camera.zoom) return
      camera.zoom = nextZoom
      camera.updateProjectionMatrix()
      if (!worldUnderCursor(clientX, clientY, after)) return
      const dx = before.x - after.x
      const dz = before.z - after.z
      camera.position.x += dx
      camera.position.z += dz
      const controls = controlsRef.current
      if (controls) {
        controls.target.x += dx
        controls.target.z += dz
        controls.update()
      }
      invalidate()
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.deltaY < 0) zoomAtCursor(event.clientX, event.clientY, zoomScale)
      else if (event.deltaY > 0) zoomAtCursor(event.clientX, event.clientY, 1 / zoomScale)
    }

    element.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    element.addEventListener('contextmenu', onContextMenu)
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      element.style.cursor = ''
      element.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      element.removeEventListener('contextmenu', onContextMenu)
      element.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [
    camera,
    enabled,
    fitZoom,
    gl.domElement,
    invalidate,
    layout,
    landEnabled,
    onLand,
    onBlueprintMenu,
    onSelect,
    onSelectFolder,
    pickingImport,
    scene,
    selectedFolder,
  ])

  return (
    <>
      {enabled && (
        <OrthographicCamera makeDefault near={1} far={2000} up={[0, 0, -1]} />
      )}
      {enabled && sized && (
        <MapControls
          ref={controlsRef}
          enabled={!flying}
          enableRotate={false}
          enableDamping
          dampingFactor={0.12}
          screenSpacePanning
          zoomToCursor
          zoomSpeed={1.15}
          minZoom={Math.max(fitZoom * 0.35, 0.05)}
          maxZoom={Math.max(fitZoom * 10, 20)}
        />
      )}
      {enabled && (
        <MapFolderLabels
          folders={layout.folders}
          highlightedFolders={highlightedFolders}
          selectedFolder={selectedFolder}
          namingFolderPath={namingFolderPath}
          pointedFolderPaths={pointedFolderPaths}
          pointedFolderColors={pointedFolderColors}
          dimmedFolderPaths={dimmedFolderPaths}
        />
      )}
      {enabled && (
        <MapFileLabels files={fileLabels} namingFileId={namingFileId} />
      )}
      {enabled && marker && <LandMarker marker={marker} />}
    </>
  )
}

const PROJECT = new THREE.Vector3()
const MIN_FOLDER_LABEL_PX = 28
const FOLDER_ENTRANCE_Z = 1.35
const MIN_FILE_LABEL_PX = 16
const FILE_LABEL_HEIGHT = 15
const FILE_LABEL_GAP = 4
const MAX_FILE_LABELS = 28
const FILE_LABEL_CHAR_W = 7.2
const FILE_LABEL_PAD_X = 12
const FILE_LABEL_MIN_W = 108
const FILE_LABEL_MAX_W = 220
const FILE_LABEL_BLOCK_SCALE = 5.2

function projectToScreen(
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  PROJECT.set(x, y, z).project(camera)
  return {
    x: (PROJECT.x * 0.5 + 0.5) * width,
    y: (-PROJECT.y * 0.5 + 0.5) * height,
    behind: PROJECT.z < -1 || PROJECT.z > 1,
  }
}

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
    dimmed ? 'map-folder-label-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const MAX_FOLDER_LABELS = 64

function orthoViewPad(
  camera: THREE.Camera,
  width: number,
  height: number,
  padPx: number,
) {
  const zoom = 'zoom' in camera ? Number(camera.zoom) : 1
  const safeZoom = Math.max(zoom, 0.001)
  const pad = padPx / safeZoom
  const hw = width / (2 * safeZoom)
  const hh = height / (2 * safeZoom)
  return {
    zoom,
    minX: camera.position.x - hw - pad,
    maxX: camera.position.x + hw + pad,
    minZ: camera.position.z - hh - pad,
    maxZ: camera.position.z + hh + pad,
  }
}

function paintFolderLabel(
  el: HTMLElement,
  folder: PlacedFolder,
  highlightedFolders: Partial<Record<string, ChangeKind>> | undefined,
  selectedFolder: string | null,
  pointed: boolean,
  pointedColors: string[],
  dimmed: boolean,
) {
  el.className = folderLabelClass(
    folder,
    highlightedFolders,
    selectedFolder,
    pointed,
    dimmed,
  )
  el.replaceChildren()
  if (pointed) {
    const hex = pointedColors[pointedColors.length - 1]
    if (hex) el.style.setProperty('--session-color', hex)
    else el.style.removeProperty('--session-color')
    for (const color of pointedColors.length > 0 ? pointedColors : ['#9ad8ff']) {
      const eye = document.createElement('span')
      eye.className = 'map-folder-eye'
      eye.style.color = color
      eye.innerHTML = eyeIconMarkup(13)
      el.appendChild(eye)
    }
  } else {
    el.style.removeProperty('--session-color')
  }
  const gitKind = folderGitKind(folder, highlightedFolders)
  const name = document.createElement('span')
  name.className = 'map-folder-name'
  name.textContent = folderKindLabel(folder.name, gitKind, folder.added ?? false)
  if (folder.colorHex) {
    const tint = blueprintPalette(folder.colorHex)
    el.style.setProperty('--blueprint-color', tint.color)
    el.style.setProperty('--blueprint-label-bg', tint.labelBg)
  } else {
    el.style.removeProperty('--blueprint-color')
    el.style.removeProperty('--blueprint-label-bg')
  }
  el.appendChild(name)
}

function MapFolderLabels({
  folders,
  highlightedFolders,
  selectedFolder,
  namingFolderPath,
  pointedFolderPaths,
  pointedFolderColors,
  dimmedFolderPaths,
}: {
  folders: Record<string, PlacedFolder>
  highlightedFolders?: Partial<Record<string, ChangeKind>>
  selectedFolder: string | null
  namingFolderPath: string | null
  pointedFolderPaths: string[]
  pointedFolderColors: Record<string, string[]>
  dimmedFolderPaths: string[]
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
  const dimmedRef = useRef(dimmedFolderPaths)
  foldersRef.current = folders
  highlightedRef.current = highlightedFolders
  selectedRef.current = selectedFolder
  namingRef.current = namingFolderPath
  pointedRef.current = pointedFolderPaths
  pointedColorsRef.current = pointedFolderColors
  dimmedRef.current = dimmedFolderPaths

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const layer = document.createElement('div')
    layer.className = 'map-folder-label-layer'
    layer.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:80;background:transparent;'
    parent.appendChild(layer)
    layerRef.current = layer
    return () => {
      layer.remove()
      layerRef.current = null
    }
  }, [gl])

  useFrame(() => {
    const layer = layerRef.current
    if (!layer) return
    const items = Object.values(foldersRef.current)
    const highlightedFolders = highlightedRef.current
    const selectedFolder = selectedRef.current
    const namingFolderPath = namingRef.current
    const pointedFolders = new Set(pointedRef.current)
    const pointedFolderColors = pointedColorsRef.current
    const dimmedFolders = new Set(dimmedRef.current)
    const view = orthoViewPad(camera, size.width, size.height, 120)
    const candidates: {
      folder: PlacedFolder
      x: number
      y: number
      span: number
      pointed: boolean
      dimmed: boolean
      rank: number
    }[] = []

    for (let i = 0; i < items.length; i += 1) {
      const folder = items[i]
      if (folder.path === namingFolderPath) continue
      const pointed = pointedFolders.has(folder.path)
      const dimmed = dimmedFolders.has(folder.path)
      const gitKind = folderGitKind(folder, highlightedFolders)
      const force =
        selectedFolder === folder.path ||
        pointed ||
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
      const screen = projectToScreen(
        folder.x,
        14,
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
        dimmed,
        rank: selectedFolder === folder.path ? 0 : pointed ? 1 : force ? 2 : 3,
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

    const nodes = layer.children
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement
      const next = visible[i]
      if (!next) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      const signature = [
        next.folder.path,
        selectedFolder === next.folder.path ? '1' : '0',
        next.pointed ? '1' : '0',
        next.dimmed ? '1' : '0',
        folderGitKind(next.folder, highlightedFolders) ?? '',
        next.folder.added ? '1' : '0',
        (pointedFolderColors[next.folder.path] ?? []).join(','),
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
          next.dimmed,
        )
      }
      const tx = Math.round(next.x)
      const ty = Math.round(next.y)
      const pos = `${tx},${ty}`
      if (el.dataset.pos !== pos) {
        el.dataset.pos = pos
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(-50%, -50%)`
      }
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
    }
  })

  return null
}

function folderKindLabel(
  name: string,
  kind: ChangeKind | null | undefined,
  added: boolean,
) {
  if (kind === 'remove') return `- ${name}`
  if (kind === 'add' || added) return `+ ${name}`
  return name
}

function fileLabelClass(file: MapFileLabel) {
  return [
    'map-file-label',
    file.selected ? 'map-file-label-selected' : '',
    file.pointed ? 'map-file-label-pointed' : '',
    file.focused ? 'map-file-label-focused' : '',
    file.dimmed ? 'map-file-label-dimmed' : '',
    file.blueprintHex ? 'map-file-label-blueprint' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function labelsOverlap(
  left: number,
  top: number,
  right: number,
  bottom: number,
  placed: { l: number; t: number; r: number; b: number }[],
) {
  for (let i = 0; i < placed.length; i += 1) {
    const box = placed[i]
    if (left < box.r && right > box.l && top < box.b && bottom > box.t) return true
  }
  return false
}

function MapFileLabels({
  files,
  namingFileId,
}: {
  files: MapFileLabel[]
  namingFileId: string | null
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const filesRef = useRef(files)
  const namingRef = useRef(namingFileId)
  filesRef.current = files
  namingRef.current = namingFileId

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const layer = document.createElement('div')
    layer.className = 'map-file-label-layer'
    layer.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:70;background:transparent;'
    parent.appendChild(layer)
    layerRef.current = layer
    return () => {
      layer.remove()
      layerRef.current = null
    }
  }, [gl])

  useFrame(() => {
    const layer = layerRef.current
    const items = filesRef.current
    if (!layer) return
    const zoom = 'zoom' in camera ? Number(camera.zoom) : 1
    const view = orthoViewPad(camera, size.width, size.height, 80)
    const cx = size.width * 0.5
    const cy = size.height * 0.5
    const candidates: {
      file: MapFileLabel
      x: number
      y: number
      w: number
      outer: 1 | -1 | 0
      rank: number
      dist: number
    }[] = []

    for (let i = 0; i < items.length; i += 1) {
      const file = items[i]
      if (file.id === namingRef.current) continue
      const block = Math.min(file.width, file.depth) * zoom
      const force = file.selected || file.pointed || file.focused || Boolean(file.overlay)
      if (!force && block < MIN_FILE_LABEL_PX) continue
      if (
        file.x < view.minX ||
        file.x > view.maxX ||
        file.z < view.minZ ||
        file.z > view.maxZ
      ) {
        continue
      }
      const screen = projectToScreen(
        file.x,
        0,
        file.z,
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
      const edgeX = onBlock
        ? screen.x
        : screen.x + file.outer * ((file.width * zoom) / 2 + FILE_LABEL_GAP)
      candidates.push({
        file,
        x: edgeX,
        y: screen.y,
        w: width,
        outer: onBlock ? 0 : file.outer,
        rank: file.selected ? 0 : file.pointed || file.focused ? 1 : 2,
        dist: Math.hypot(screen.x - cx, screen.y - cy),
      })
    }

    candidates.sort((a, b) => a.rank - b.rank || a.dist - b.dist)

    const placed: { l: number; t: number; r: number; b: number }[] = []
    const visible: typeof candidates = []
    for (let i = 0; i < candidates.length && visible.length < MAX_FILE_LABELS; i += 1) {
      const next = candidates[i]
      const left =
        next.outer === 1 ? next.x : next.outer === -1 ? next.x - next.w : next.x - next.w / 2
      const right =
        next.outer === 1 ? next.x + next.w : next.outer === -1 ? next.x : next.x + next.w / 2
      const top = next.y - FILE_LABEL_HEIGHT / 2
      const bottom = next.y + FILE_LABEL_HEIGHT / 2
      if (labelsOverlap(left, top - 2, right, bottom + 2, placed)) continue
      placed.push({ l: left, t: top, r: right, b: bottom })
      visible.push(next)
    }

    while (layer.children.length < visible.length) {
      const el = document.createElement('div')
      el.className = 'map-file-label'
      el.style.position = 'absolute'
      el.style.top = '0'
      el.style.left = '0'
      el.style.visibility = 'hidden'
      const name = document.createElement('span')
      name.className = 'map-file-name'
      el.appendChild(name)
      layer.appendChild(el)
    }

    const nodes = layer.children
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement
      const next = visible[i]
      if (!next) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      const name = el.firstElementChild as HTMLElement | null
      const className = fileLabelClass(next.file)
      if (el.className !== className) el.className = className
      if (el.dataset.id !== next.file.id) {
        el.dataset.id = next.file.id
      }
      if (next.file.pointed && next.file.pointedColor) {
        el.style.setProperty('--session-color', next.file.pointedColor)
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
      if (name && name.textContent !== next.file.name) name.textContent = next.file.name
      el.style.maxWidth = `${Math.round(next.w)}px`
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
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
    }
  })

  return null
}

function LandMarker({ marker }: { marker: [number, number] }) {
  const camera = useThree((state) => state.camera)
  const ring = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera) || !ring.current) return
    const size = THREE.MathUtils.clamp(16 / Math.max(camera.zoom, 0.04), 2.4, 22)
    ring.current.scale.setScalar(size)
  })

  return (
    <group position={[marker[0], 0.35, marker[1]]}>
      <group ref={ring}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.62, 32]} />
          <meshBasicMaterial color="#e8c36a" transparent opacity={0.28} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.5, 0.72, 32]} />
          <meshBasicMaterial color="#e8c36a" side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <circleGeometry args={[0.18, 20]} />
          <meshBasicMaterial color="#fff6d4" />
        </mesh>
      </group>
      <Html
        center
        zIndexRange={[20, 10]}
        style={{ pointerEvents: 'none' }}
        position={[0, 2.8, 0]}
      >
        <div className="map-you-are-here" role="img" aria-label="You are here">
          <span className="map-you-are-here-pin" aria-hidden="true" />
        </div>
      </Html>
    </group>
  )
}
