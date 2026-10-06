import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, MapControls, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { folderAt, folderOfFile, worldBounds } from '../layout'
import { onMapViewResetRequest, publishMapViewAngle } from '../mapViewAngle'
import { MAP_VIEW, type ChangeKind } from '../theme'
import type { WorldLayout } from '../types'
import { MapFileLabels, type MapFileLabel } from './MapFileLabels'
import { MapFolderLabels } from './MapFolderLabels'
import type { MapSheet } from './mapLabelOcclusion'
import {
  holdOrbitPivot,
  isOrbitGesture,
  pivotSettled,
  type OrbitPivot,
} from './mapOrbitPivot'
import {
  MAP_MAX_TILT,
  MAP_TOP_DOWN,
  angleFromCamera,
  applyMapPose,
  fitZoomFor,
  flightPose,
  mapCameraDistance,
  poseFromCamera,
  poseOf,
  type MapControlsHandle,
  type MapFlight,
  type MapPose,
  type MapViewport,
} from './mapCamera'

export type MapBlueprintMenu = {
  x: number
  y: number
  folder?: string
  file?: string
  color?: string
}

export type MapFocusBounds = {
  cx: number
  cz: number
  width: number
  depth: number
}

const FOCUS_FLY_IN_MS = 900
const FOCUS_FLY_OUT_IN_MS = 1500
const FOCUS_FLY_SPLIT = 0.4

/** Left drag pans; Shift/Cmd + left drag or middle drag tilts and rotates around the point under the mouse. Right click stays the context menu. */
const MAP_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.ROTATE,
  RIGHT: -1 as THREE.MOUSE,
}

type MapControlsRef = ElementRef<typeof MapControls> & MapControlsHandle

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
  notedFolderPaths?: string[]
  notedFolderColors?: Record<string, string[]>
  fileLabels?: MapFileLabel[]
  focusBounds?: MapFocusBounds | null
  focusFlightKey?: string | number
  revealBounds?: MapFocusBounds | null
  revealFlightKey?: string | number
  hudReserve?: number
  topReserve?: number
  landEnabled?: boolean
  droppingWalk?: boolean
  dimmedFolderPaths?: string[]
  onLand: (x: number, z: number) => void
  onSelect: (fileId: string | null) => void
  onSelectFolder: (folderPath: string | null, layer?: string | null) => void
  pickingImport?: boolean
  onBlueprintMenu?: (menu: MapBlueprintMenu) => void
  blueprintOpacity?: number
  blueprintSheets?: MapSheet[]
  folderLabelAnchors?: Record<string, MapSheet>
}

const NO_SHEETS: MapSheet[] = []
const NO_ANCHORS: Record<string, MapSheet> = {}

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
  notedFolderPaths = [],
  notedFolderColors = {},
  fileLabels = [],
  focusBounds = null,
  focusFlightKey = 0,
  revealBounds = null,
  revealFlightKey = 0,
  hudReserve = 88,
  topReserve = 28,
  landEnabled = true,
  droppingWalk = false,
  dimmedFolderPaths = [],
  onLand,
  onSelect,
  onSelectFolder,
  onBlueprintMenu,
  pickingImport = false,
  blueprintOpacity = 1,
  blueprintSheets = NO_SHEETS,
  folderLabelAnchors = NO_ANCHORS,
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
  const view = useMemo<MapViewport>(
    () => ({ width: viewWidth, height: viewHeight, hudReserve }),
    [hudReserve, viewHeight, viewWidth],
  )
  const distance = mapCameraDistance(world)

  const fitZoom = sized ? fitZoomFor(bounds, view) : 8
  const controlsRef = useRef<MapControlsRef>(null)
  const poseRef = useRef<MapPose>(poseOf(bounds))
  const flightRef = useRef<MapFlight | null>(null)
  const flightKeyRef = useRef<number | string | null>(null)
  const revealKeyRef = useRef<number | string | null>(null)
  const worldFitRef = useRef({ cx: world.cx, cz: world.cz, width: world.width, depth: world.depth })
  const focusingRef = useRef(false)
  const preFocusPoseRef = useRef<MapPose | null>(null)
  const fittedRef = useRef(false)
  const [flying, setFlying] = useState(false)
  const [dropAt, setDropAt] = useState<[number, number] | null>(null)

  const snapTo = (pose: MapPose) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return
    flightRef.current = null
    poseRef.current = pose
    applyMapPose(camera, pose, view, distance, controlsRef.current)
    setFlying(false)
    invalidate()
  }

  useLayoutEffect(() => {
    if (!enabled) {
      fittedRef.current = false
      revealKeyRef.current = null
      return
    }
    if (!(camera instanceof THREE.OrthographicCamera)) return
    const angle = poseRef.current
    const target = poseOf(bounds, angle)
    const key = focusing ? focusFlightKey : 'map'
    const wasFocusing = focusingRef.current
    const prevKey = flightKeyRef.current
    if (focusing && !wasFocusing) {
      preFocusPoseRef.current = poseRef.current
    }
    focusingRef.current = focusing
    flightKeyRef.current = key

    const worldMoved =
      worldFitRef.current.cx !== world.cx ||
      worldFitRef.current.cz !== world.cz ||
      worldFitRef.current.width !== world.width ||
      worldFitRef.current.depth !== world.depth
    worldFitRef.current = {
      cx: world.cx,
      cz: world.cz,
      width: world.width,
      depth: world.depth,
    }

    if (!sized) {
      if (!focusing && wasFocusing) {
        const restore = preFocusPoseRef.current ?? poseOf(world, angle)
        preFocusPoseRef.current = null
        snapTo(restore)
        fittedRef.current = true
        return
      }
      snapTo(target)
      return
    }

    if (!focusing && wasFocusing) {
      const restore = preFocusPoseRef.current ?? poseOf(world, angle)
      preFocusPoseRef.current = null
      flightRef.current = {
        from: poseRef.current,
        via: poseRef.current,
        to: restore,
        start: performance.now(),
        duration: FOCUS_FLY_IN_MS,
        split: 0,
      }
      setFlying(true)
      fittedRef.current = true
      invalidate()
      return
    }

    if (focusing && prevKey !== null && prevKey !== key) {
      flightRef.current = {
        from: poseRef.current,
        via: wasFocusing ? poseOf(world, angle) : poseRef.current,
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

    if (!fittedRef.current) {
      snapTo(target)
      fittedRef.current = true
      return
    }

    const current = poseFromCamera(camera, view, controlsRef.current)
    poseRef.current = current

    if (revealBounds && revealKeyRef.current !== revealFlightKey) {
      revealKeyRef.current = revealFlightKey
      flightRef.current = {
        from: current,
        via: current,
        to: {
          ...current,
          cx: revealBounds.cx,
          cz: revealBounds.cz,
          width: Math.max(current.width, revealBounds.width),
          depth: Math.max(current.depth, revealBounds.depth),
        },
        start: performance.now(),
        duration: FOCUS_FLY_IN_MS,
        split: 0,
      }
      setFlying(true)
      invalidate()
      return
    }

    if (worldMoved) {
      const stillInView =
        current.cx + current.width / 2 > world.minX &&
        current.cx - current.width / 2 < world.maxX &&
        current.cz + current.depth / 2 > world.minZ &&
        current.cz - current.depth / 2 < world.maxZ
      if (stillInView) return
      snapTo(poseOf(world, angle))
      return
    }

    applyMapPose(camera, poseRef.current, view, distance, controlsRef.current)
    invalidate()
  }, [
    bounds.cx,
    bounds.cz,
    bounds.depth,
    bounds.width,
    camera,
    distance,
    enabled,
    focusFlightKey,
    focusing,
    invalidate,
    revealBounds?.cx,
    revealBounds?.cz,
    revealBounds?.depth,
    revealBounds?.width,
    revealFlightKey,
    sized,
    view,
    world.cx,
    world.cz,
    world.depth,
    world.width,
  ])

  useFrame(() => {
    if (!enabled || !(camera instanceof THREE.OrthographicCamera)) return
    const flight = flightRef.current
    if (flight) {
      const { t, pose } = flightPose(flight, performance.now())
      const done = t >= 1
      poseRef.current = done ? flight.to : pose
      applyMapPose(camera, poseRef.current, view, distance, controlsRef.current)
      if (done) {
        flightRef.current = null
        setFlying(false)
      }
    } else if (fittedRef.current && !focusing) {
      poseRef.current = poseFromCamera(camera, view, controlsRef.current)
    }
    publishMapViewAngle(angleFromCamera(camera, controlsRef.current))
  })

  useEffect(() => {
    if (!enabled) return
    return onMapViewResetRequest(() => {
      if (!(camera instanceof THREE.OrthographicCamera)) return
      const from = poseFromCamera(camera, view, controlsRef.current)
      flightRef.current = {
        from,
        via: from,
        to: { ...from, ...MAP_TOP_DOWN },
        start: performance.now(),
        duration: MAP_VIEW.resetMs,
        split: 0,
      }
      setFlying(true)
      invalidate()
    })
  }, [camera, enabled, invalidate, view])

  useEffect(() => {
    if (!enabled) return
    const element = gl.domElement
    const restCursor = pickingImport ? 'crosshair' : 'grab'
    element.style.cursor = restCursor

    const isWalkClick = (event: PointerEvent | MouseEvent) =>
      landEnabled && event.altKey

    // Primary click only. Mac ctrl-click is a context-menu gesture (button 0 + ctrlKey).
    const isSelectClick = (event: PointerEvent) =>
      event.button === 0 && !event.ctrlKey

    const onDown = (event: PointerEvent) => {
      if (droppingWalk) return
      if (!isSelectClick(event)) return
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
      if (!startedOnCanvas || !isSelectClick(event) || drag.current.moved) return

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
      if (pick.fileId) {
        onBlueprintMenu({
          x: event.clientX,
          y: event.clientY,
          file: pick.fileId,
          folder: folderOfFile(pick.fileId),
        })
        return
      }
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
    droppingWalk,
  ])

  useEffect(() => {
    const controls = controlsRef.current
    if (!enabled || !sized || flying || !controls) return
    const element = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let pivot: OrbitPivot | null = null

    const mapPointAt = (ndc: THREE.Vector2) => {
      raycaster.setFromCamera(ndc, camera)
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        if (fileIdFromHit(hit) || mapFolderFromHit(hit)) return hit.point.clone()
      }
      const point = new THREE.Vector3()
      return raycaster.ray.intersectPlane(ground, point) ? point : null
    }

    const onDown = (event: PointerEvent) => {
      pivot = null
      if (!isOrbitGesture(event)) return
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const point = mapPointAt(ndc)
      if (point) pivot = { point, ndc, releasedAt: null }
    }
    const onUp = () => {
      if (pivot && pivot.releasedAt === null) pivot.releasedAt = performance.now()
    }
    const onWheel = () => {
      pivot = null
    }
    const onChange = () => {
      if (!pivot) return
      if (pivotSettled(pivot, performance.now())) {
        pivot = null
        return
      }
      holdOrbitPivot(camera, controls, pivot)
    }

    element.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    controls.addEventListener('change', onChange)
    return () => {
      element.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('wheel', onWheel, { capture: true })
      controls.removeEventListener('change', onChange)
    }
  }, [camera, enabled, flying, gl.domElement, scene, sized])

  useEffect(() => {
    if (!enabled || !droppingWalk || !landEnabled) {
      setDropAt(null)
      return
    }
    const element = gl.domElement
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const ndc = new THREE.Vector2()
    const hit = new THREE.Vector3()
    const raycaster = new THREE.Raycaster()

    const worldAt = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return null
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(ground, hit)) return null
      return [hit.x, hit.z] as [number, number]
    }

    const overHudChrome = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return false
      return Boolean(
        target.closest(
          '.hud-walk-drop, .hud-bottom, .hud-top, .hud-left-stack, .hud-right-stack, .hud-panel, .hud-instructions-overlay',
        ),
      )
    }

    const onDropMove = (event: PointerEvent) => {
      if (overHudChrome(event)) {
        setDropAt(null)
        return
      }
      setDropAt(worldAt(event.clientX, event.clientY))
    }

    const onDropUp = (event: PointerEvent) => {
      if (overHudChrome(event)) {
        setDropAt(null)
        return
      }
      const at = worldAt(event.clientX, event.clientY)
      setDropAt(null)
      if (!at) return
      const lock = element.requestPointerLock()
      if (lock && typeof lock.catch === 'function') {
        void lock.catch(() => {})
      }
      onLand(at[0], at[1])
    }

    window.addEventListener('pointermove', onDropMove)
    window.addEventListener('pointerup', onDropUp, true)
    return () => {
      window.removeEventListener('pointermove', onDropMove)
      window.removeEventListener('pointerup', onDropUp, true)
    }
  }, [camera, droppingWalk, enabled, gl.domElement, landEnabled, onLand])

  return (
    <>
      {enabled && (
        <OrthographicCamera makeDefault near={1} far={distance * 3} />
      )}
      {enabled && sized && (
        <MapControls
          ref={controlsRef}
          enabled={!flying && !droppingWalk}
          enableRotate
          rotateSpeed={MAP_VIEW.rotateSpeed}
          minPolarAngle={0}
          maxPolarAngle={MAP_MAX_TILT}
          mouseButtons={MAP_MOUSE_BUTTONS}
          enableDamping
          dampingFactor={0.12}
          screenSpacePanning={false}
          zoomToCursor
          zoomSpeed={1.15}
          minZoom={Math.min(
            camera instanceof THREE.OrthographicCamera ? camera.zoom : fitZoom,
            Math.max(fitZoom * 0.35, 0.05),
          )}
          maxZoom={Math.max(
            fitZoom * 10,
            20,
            camera instanceof THREE.OrthographicCamera ? camera.zoom : 20,
          )}
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
          notedFolderPaths={notedFolderPaths}
          notedFolderColors={notedFolderColors}
          dimmedFolderPaths={dimmedFolderPaths}
          blueprintOpacity={blueprintOpacity}
          sheets={blueprintSheets}
          anchors={folderLabelAnchors}
        />
      )}
      {enabled && (
        <MapFileLabels
          files={fileLabels}
          namingFileId={namingFileId}
          blueprintOpacity={blueprintOpacity}
          sheets={blueprintSheets}
        />
      )}
      {enabled && marker && <LandMarker marker={marker} />}
      {enabled && dropAt && <WalkDropMarker at={dropAt} />}
    </>
  )
}

function WalkDropMarker({ at }: { at: [number, number] }) {
  return (
    <group position={[at[0], 0.02, at[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.82, 32]} />
        <meshBasicMaterial
          color="#e8c36a"
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Html
        center
        zIndexRange={[22, 12]}
        style={{ pointerEvents: 'none' }}
        position={[0, 2.4, 0]}
      >
        <div className="map-walk-drop-preview" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28">
            <circle cx="12" cy="5.2" r="3.3" fill="#e8c36a" />
            <path
              fill="#e8c36a"
              d="M9.1 9.2c0-.7.6-1.3 1.3-1.3h3.2c.7 0 1.3.6 1.3 1.3v4.4c0 .4-.3.7-.7.7h-.5v7.1c0 .5-.4.9-.9.9h-.5c-.5 0-.9-.4-.9-.9v-7.1h-.5c-.4 0-.7-.3-.7-.7z"
            />
          </svg>
        </div>
      </Html>
    </group>
  )
}

function LandMarker({ marker }: { marker: [number, number] }) {
  return (
    <group position={[marker[0], 0.35, marker[1]]}>
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
