import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  fileChangeKind,
  filesImporting,
  folderAt,
  folderChangeHighlights,
  folderOfFile,
} from '../layout'
import { CONFIG, WORLD_VOID, type ChangeKind } from '../theme'
import { shouldIgnoreShortcut } from '../keyboard'
import type { CodebaseGraph, PlacedFile, PlacedFolder, WorldLayout } from '../types'
import { FileBlock } from './FileBlock'
import { FolderArea } from './FolderArea'
import { RelationLines } from './RelationLines'

type Vec3 = [number, number, number]
type Orbit = { yaw: number; pitch: number }

type SelectionThumbnailProps = {
  graph: CodebaseGraph
  layout: WorldLayout
  selectedId: string | null
  selectedFolder: string | null
  landAt: [number, number]
  importedBy?: boolean
  minimized?: boolean
  maximized?: boolean
  plannedIds?: string[]
  createdIds?: string[]
  deletedIds?: string[]
  onMinimize?: () => void
  onMaximize?: () => void
  onHide: () => void
}

type ThumbnailTarget = {
  folder: PlacedFolder
  files: Array<{ file: CodebaseGraph['files'][number]; placed: PlacedFile }>
  relatedIds: Set<string>
  selectedFileId: string | null
  camera: {
    position: [number, number, number]
    lookAt: [number, number, number]
  }
}

function elevatedCamera(
  lookAt: [number, number, number],
  spanX: number,
  spanY: number,
  spanZ: number,
  towardX: 1 | -1,
): ThumbnailTarget['camera'] {
  const span = Math.max(spanX, spanZ, 4)
  const distance = Math.max(12, span * 0.9, spanY * 1.8)
  const height = Math.max(CONFIG.eyeHeight * 6, spanY + 8, distance * 0.7)
  return {
    position: [
      lookAt[0] + towardX * distance * 0.55,
      lookAt[1] + height,
      lookAt[2] + distance * 0.72,
    ],
    lookAt,
  }
}

function filesOnFolder(
  graph: CodebaseGraph,
  layout: WorldLayout,
  folderPath: string,
) {
  return graph.files.flatMap((file) => {
    if (file.folder !== folderPath && folderOfFile(file.id) !== folderPath) {
      return []
    }
    const placed = layout.files[file.id]
    return placed ? [{ file, placed }] : []
  })
}

function resolveTarget(
  graph: CodebaseGraph,
  layout: WorldLayout,
  selectedId: string | null,
  selectedFolder: string | null,
  landAt: [number, number],
  importedBy: boolean,
): ThumbnailTarget | null {
  const selectedFile = selectedId
    ? graph.files.find((file) => file.id === selectedId)
    : undefined
  const selectedPlaced = selectedFile
    ? layout.files[selectedFile.id]
    : undefined

  const folder =
    (selectedFile
      ? layout.folders[selectedFile.folder] ??
        layout.folders[folderOfFile(selectedFile.id)]
      : undefined) ??
    (selectedFolder ? layout.folders[selectedFolder] : undefined) ??
    folderAt(landAt[0], landAt[1], layout) ??
    Object.values(layout.folders)[0]
  if (!folder) return null

  const islandFiles = filesOnFolder(graph, layout, folder.path)
  const relatedIds = new Set(
    selectedFile
      ? importedBy
        ? filesImporting(graph.files, selectedFile.id).map((file) => file.id)
        : selectedFile.imports
      : [],
  )
  const extraFiles = graph.files.flatMap((file) => {
    if (!relatedIds.has(file.id)) return []
    if (islandFiles.some((entry) => entry.file.id === file.id)) return []
    const placed = layout.files[file.id]
    return placed ? [{ file, placed }] : []
  })
  const files = [...islandFiles, ...extraFiles]

  if (selectedPlaced) {
    const [width, height, depth] = selectedPlaced.size
    return {
      folder,
      files,
      relatedIds,
      selectedFileId: selectedFile?.id ?? null,
      camera: elevatedCamera(
        [
          selectedPlaced.position[0],
          selectedPlaced.position[1],
          selectedPlaced.position[2],
        ],
        width,
        height,
        depth,
        selectedPlaced.aisleFace,
      ),
    }
  }

  const tallest = files.reduce(
    (height, entry) => Math.max(height, entry.placed.size[1]),
    CONFIG.minHeight,
  )
  return {
    folder,
    files,
    relatedIds,
    selectedFileId: null,
    camera: elevatedCamera(
      [folder.x, 1.2, folder.z + folder.depth / 2],
      folder.width,
      tallest,
      folder.depth,
      1,
    ),
  }
}

const MIN_ZOOM = 0.45
const MAX_ZOOM = 6
const MIN_ORBIT_PITCH = 0.08
const MAX_ORBIT_PITCH = Math.PI / 2 - 0.06
const ZERO_PAN: Vec3 = [0, 0, 0]
const ZERO_ORBIT: Orbit = { yaw: 0, pitch: 0 }
const WORLD_UP: Vec3 = [0, 1, 0]
const LABEL_PROJECT = new THREE.Vector3()
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const CURSOR_NDC = new THREE.Vector2()
const CURSOR_BEFORE = new THREE.Vector3()
const CURSOR_AFTER = new THREE.Vector3()
const CURSOR_RAY = new THREE.Raycaster()
const ZOOM_SCALE = Math.pow(0.95, 1.15)

type LabelCandidate = {
  id: string
  position: Vec3
  priority: number
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vecScale(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale]
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function vecLength(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2])
}

function vecNormalize(a: Vec3): Vec3 {
  const length = vecLength(a)
  return length < 1e-6 ? a : vecScale(a, 1 / length)
}

function cameraOffset(position: Vec3, lookAt: Vec3, zoom: number): Vec3 {
  return vecScale(vecSub(position, lookAt), 1 / zoom)
}

function sphericalFromOffset(offset: Vec3) {
  const radius = vecLength(offset)
  return {
    radius,
    yaw: Math.atan2(offset[0], offset[2]),
    pitch: Math.asin(
      Math.min(1, Math.max(-1, offset[1] / Math.max(radius, 1e-6))),
    ),
  }
}

function offsetFromSpherical(radius: number, yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch)
  return [
    radius * Math.sin(yaw) * cosPitch,
    radius * Math.sin(pitch),
    radius * Math.cos(yaw) * cosPitch,
  ]
}

function clampOrbitPitch(basePitch: number, orbitPitch: number) {
  return Math.min(
    MAX_ORBIT_PITCH - basePitch,
    Math.max(MIN_ORBIT_PITCH - basePitch, orbitPitch),
  )
}

function orbitedOffset(
  position: Vec3,
  lookAt: Vec3,
  zoom: number,
  orbit: Orbit,
): Vec3 {
  const base = cameraOffset(position, lookAt, zoom)
  if (orbit.yaw === 0 && orbit.pitch === 0) return base
  const spherical = sphericalFromOffset(base)
  return offsetFromSpherical(
    spherical.radius,
    spherical.yaw + orbit.yaw,
    Math.min(
      MAX_ORBIT_PITCH,
      Math.max(MIN_ORBIT_PITCH, spherical.pitch + orbit.pitch),
    ),
  )
}

function applyThumbnailCamera(
  camera: THREE.Camera,
  position: Vec3,
  lookAt: Vec3,
  zoom: number,
  pan: Vec3,
  orbit: Orbit,
) {
  const offset = orbitedOffset(position, lookAt, zoom, orbit)
  camera.up.set(0, 1, 0)
  camera.position.set(
    lookAt[0] + pan[0] + offset[0],
    lookAt[1] + pan[1] + offset[1],
    lookAt[2] + pan[2] + offset[2],
  )
  camera.lookAt(lookAt[0] + pan[0], lookAt[1] + pan[1], lookAt[2] + pan[2])
  camera.updateProjectionMatrix()
}

function worldUnderCursor(
  camera: THREE.Camera,
  element: HTMLElement,
  clientX: number,
  clientY: number,
  target: THREE.Vector3,
) {
  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  CURSOR_NDC.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  CURSOR_RAY.setFromCamera(CURSOR_NDC, camera)
  return Boolean(CURSOR_RAY.ray.intersectPlane(GROUND_PLANE, target))
}

function cameraPanBasis(
  position: Vec3,
  lookAt: Vec3,
  zoom: number,
  orbit: Orbit,
) {
  const offset = orbitedOffset(position, lookAt, zoom, orbit)
  const forward = vecNormalize(vecScale(offset, -1))
  const right = vecNormalize(vecCross(forward, WORLD_UP))
  const up = vecNormalize(vecCross(right, forward))
  return { right, up, distance: vecLength(offset) }
}

function sameIdSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

function priorityLabels(candidates: LabelCandidate[], limit: number) {
  return new Set(
    [...candidates]
      .sort((left, right) => right.priority - left.priority)
      .slice(0, limit)
      .map((candidate) => candidate.id),
  )
}

function visibleThumbnailLabels(
  candidates: LabelCandidate[],
  camera: THREE.Camera,
  width: number,
  height: number,
  zoom: number,
) {
  if (candidates.length <= 4) {
    return new Set(candidates.map((candidate) => candidate.id))
  }

  const maxLabels = zoom < 0.85 ? 5 : zoom < 1.35 ? 8 : zoom < 2.2 ? 12 : 18
  const boxW = Math.max(40, 78 / Math.sqrt(Math.max(zoom, 0.5)))
  const boxH = Math.max(12, 18 / Math.sqrt(Math.max(zoom, 0.5)))
  const ranked = [...candidates].sort((left, right) => right.priority - left.priority)
  const placed: Array<{ x: number; y: number }> = []
  const visible = new Set<string>()

  for (const candidate of ranked) {
    LABEL_PROJECT.set(
      candidate.position[0],
      candidate.position[1],
      candidate.position[2],
    ).project(camera)
    if (LABEL_PROJECT.z < -1 || LABEL_PROJECT.z > 1) continue
    const x = (LABEL_PROJECT.x * 0.5 + 0.5) * width
    const y = (-LABEL_PROJECT.y * 0.5 + 0.5) * height
    if (x < -24 || x > width + 24 || y < -16 || y > height + 16) continue

    const essential = candidate.priority >= 1000
    const overlaps = placed.some(
      (other) => Math.abs(other.x - x) < boxW && Math.abs(other.y - y) < boxH,
    )
    if (overlaps && !essential) continue
    if (visible.size >= maxLabels && !essential) continue

    placed.push({ x, y })
    visible.add(candidate.id)
  }

  return visible
}

function touchDistance(touches: TouchList) {
  if (touches.length < 2) return 0
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  )
}

function CameraRig({
  position,
  lookAt,
  zoomRef,
  panRef,
  orbitRef,
  cameraRef,
}: {
  position: Vec3
  lookAt: Vec3
  zoomRef: { current: number }
  panRef: { current: Vec3 }
  orbitRef: { current: Orbit }
  cameraRef: { current: THREE.Camera | null }
}) {
  const { camera } = useThree()
  cameraRef.current = camera
  const aim = () => {
    applyThumbnailCamera(
      camera,
      position,
      lookAt,
      zoomRef.current,
      panRef.current,
      orbitRef.current,
    )
  }

  useLayoutEffect(aim, [
    camera,
    cameraRef,
    lookAt,
    orbitRef,
    panRef,
    position,
    zoomRef,
  ])
  useFrame(aim)
  return null
}

function ThumbnailLabelFilter({
  candidates,
  zoom,
  frozenRef,
  onChange,
}: {
  candidates: LabelCandidate[]
  zoom: number
  frozenRef: { current: boolean }
  onChange: (ids: Set<string>) => void
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const visibleRef = useRef<Set<string>>(new Set())

  useFrame(() => {
    if (frozenRef.current) return
    const next = visibleThumbnailLabels(
      candidates,
      camera,
      size.width,
      size.height,
      zoom,
    )
    if (sameIdSet(visibleRef.current, next)) return
    visibleRef.current = next
    onChange(next)
  })

  return null
}

function ThumbnailScene({
  graph,
  layout,
  importedBy,
  target,
  highlightedFolders,
  planned,
  created,
  deleted,
  zoom,
  zoomRef,
  panRef,
  orbitRef,
  cameraRef,
  frozenRef,
  visibleLabelIds,
  onVisibleLabels,
}: {
  graph: CodebaseGraph
  layout: WorldLayout
  importedBy: boolean
  target: ThumbnailTarget
  highlightedFolders: Partial<Record<string, ChangeKind>>
  planned: Set<string>
  created: Set<string>
  deleted: Set<string>
  zoom: number
  zoomRef: { current: number }
  panRef: { current: Vec3 }
  orbitRef: { current: Orbit }
  cameraRef: { current: THREE.Camera | null }
  frozenRef: { current: boolean }
  visibleLabelIds: Set<string>
  onVisibleLabels: (ids: Set<string>) => void
}) {
  const labelCandidates = useMemo(
    () =>
      target.files.map(({ file, placed }) => {
        const selected = file.id === target.selectedFileId
        const related = target.relatedIds.has(file.id)
        const changeKind = fileChangeKind(file.id, planned, created, deleted)
        const dimmed =
          Boolean(target.selectedFileId) &&
          !selected &&
          !related &&
          !changeKind
        let priority = placed.size[1]
        if (selected) priority += 1000
        else if (related) priority += 400
        else if (changeKind) priority += 300
        else if (file.userCreated) priority += 80
        if (dimmed) priority -= 200
        return {
          id: file.id,
          position: [
            placed.position[0],
            placed.position[1] + placed.size[1] / 2 + 0.4,
            placed.position[2],
          ] satisfies Vec3,
          priority,
        }
      }),
    [created, deleted, planned, target],
  )

  return (
    <>
      <color attach="background" args={[WORLD_VOID]} />
      <hemisphereLight args={['#d7e2ee', '#2a3038', 1.1]} />
      <directionalLight position={[8, 60, 8]} intensity={1.35} />
      <ambientLight intensity={0.7} />
      <pointLight
        position={[
          target.camera.position[0],
          target.camera.position[1] - 1.4,
          target.camera.position[2],
        ]}
        color="#f4f1e8"
        intensity={7}
        distance={40}
        decay={1.2}
      />
      <CameraRig
        position={target.camera.position}
        lookAt={target.camera.lookAt}
        zoomRef={zoomRef}
        panRef={panRef}
        orbitRef={orbitRef}
        cameraRef={cameraRef}
      />
      <ThumbnailLabelFilter
        candidates={labelCandidates}
        zoom={zoom}
        frozenRef={frozenRef}
        onChange={onVisibleLabels}
      />
      <FolderArea
        folder={target.folder}
        highlightKind={highlightedFolders[target.folder.path] ?? null}
        previewLabels={zoom < 1.45}
      />
      {target.files.map(({ file, placed }) => {
        const selected = file.id === target.selectedFileId
        const related = target.relatedIds.has(file.id)
        const changeKind = fileChangeKind(file.id, planned, created, deleted)
        return (
          <FileBlock
            key={file.id}
            file={file}
            placed={placed}
            selected={selected}
            related={related}
            planned={Boolean(changeKind)}
            changeKind={changeKind}
            added={created.has(file.id) || file.userCreated}
            highlightMapChange
            previewLabels
            labelVisible={visibleLabelIds.has(file.id)}
            dimmed={
              Boolean(target.selectedFileId) &&
              !selected &&
              !related &&
              !changeKind
            }
          />
        )
      })}
      {target.selectedFileId && (
        <RelationLines
          selectedId={target.selectedFileId}
          aimedRelation={null}
          files={graph.files}
          layout={layout}
          fromAbove
          importedBy={importedBy}
        />
      )}
    </>
  )
}

export function SelectionThumbnail({
  graph,
  layout,
  selectedId,
  selectedFolder,
  landAt,
  importedBy = false,
  minimized = false,
  maximized = false,
  plannedIds = [],
  createdIds = [],
  deletedIds = [],
  onMinimize,
  onMaximize,
  onHide,
}: SelectionThumbnailProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const zoomRef = useRef(1)
  const panRef = useRef<Vec3>(ZERO_PAN)
  const orbitRef = useRef<Orbit>(ZERO_ORBIT)
  const pinchRef = useRef({ start: 0, zoom: 1 })
  const zoomAtCursorRef = useRef(
    (_clientX: number, _clientY: number, _dollyScale: number) => {},
  )
  const dragRef = useRef({
    pointerId: -1,
    x: 0,
    y: 0,
    pan: ZERO_PAN,
    orbit: ZERO_ORBIT,
    rotate: false,
  })
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const [orbiting, setOrbiting] = useState(false)
  const [visibleLabelIds, setVisibleLabelIds] = useState<Set<string>>(
    () => new Set(),
  )
  const planned = useMemo(() => new Set(plannedIds), [plannedIds])
  const created = useMemo(() => new Set(createdIds), [createdIds])
  const deleted = useMemo(() => new Set(deletedIds), [deletedIds])
  const highlightedFolders = useMemo(
    () => folderChangeHighlights(planned, created, deleted, layout.folders),
    [created, deleted, layout.folders, planned],
  )
  const target = useMemo(
    () =>
      resolveTarget(
        graph,
        layout,
        selectedId,
        selectedFolder,
        landAt,
        importedBy,
      ),
    [graph, importedBy, landAt, layout, selectedFolder, selectedId],
  )

  const panningRef = useRef(false)

  useEffect(() => {
    zoomRef.current = 1
    panRef.current = ZERO_PAN
    orbitRef.current = ZERO_ORBIT
    setZoom(1)
    panningRef.current = false
    setPanning(false)
    setOrbiting(false)
  }, [selectedId, selectedFolder, landAt])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    if (!target) {
      setVisibleLabelIds(new Set())
      return
    }
    const candidates = target.files.map(({ file, placed }) => {
      const selected = file.id === target.selectedFileId
      const related = target.relatedIds.has(file.id)
      const changeKind = fileChangeKind(file.id, planned, created, deleted)
      let priority = placed.size[1]
      if (selected) priority += 1000
      else if (related) priority += 400
      else if (changeKind) priority += 300
      return { id: file.id, position: placed.position, priority }
    })
    setVisibleLabelIds(priorityLabels(candidates, 8))
  }, [created, deleted, planned, target])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || minimized || !target) return

    const zoomAtCursor = (
      clientX: number,
      clientY: number,
      dollyScale: number,
    ) => {
      const camera = cameraRef.current
      const nextZoom = clampZoom(zoomRef.current / dollyScale)
      if (nextZoom === zoomRef.current) return
      const hit =
        camera !== null &&
        worldUnderCursor(camera, stage, clientX, clientY, CURSOR_BEFORE)
      zoomRef.current = nextZoom
      if (camera) {
        applyThumbnailCamera(
          camera,
          target.camera.position,
          target.camera.lookAt,
          nextZoom,
          panRef.current,
          orbitRef.current,
        )
        if (
          hit &&
          worldUnderCursor(camera, stage, clientX, clientY, CURSOR_AFTER)
        ) {
          panRef.current = [
            panRef.current[0] + CURSOR_BEFORE.x - CURSOR_AFTER.x,
            panRef.current[1],
            panRef.current[2] + CURSOR_BEFORE.z - CURSOR_AFTER.z,
          ]
          applyThumbnailCamera(
            camera,
            target.camera.position,
            target.camera.lookAt,
            nextZoom,
            panRef.current,
            orbitRef.current,
          )
        }
      }
      setZoom(nextZoom)
    }
    zoomAtCursorRef.current = zoomAtCursor

    const pointerOverStage = (clientX: number, clientY: number) => {
      const rect = stage.getBoundingClientRect()
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      )
    }

    const onWheel = (event: WheelEvent) => {
      if (!pointerOverStage(event.clientX, event.clientY)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.deltaY < 0) zoomAtCursor(event.clientX, event.clientY, ZOOM_SCALE)
      else if (event.deltaY > 0) {
        zoomAtCursor(event.clientX, event.clientY, 1 / ZOOM_SCALE)
      }
    }

    const onGestureStart = (event: Event) => {
      event.preventDefault()
      pinchRef.current.zoom = zoomRef.current
    }

    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const scale = Number((event as Event & { scale?: number }).scale)
      if (!Number.isFinite(scale) || scale <= 0) return
      const nextZoom = clampZoom(pinchRef.current.zoom * scale)
      const dolly = zoomRef.current / Math.max(nextZoom, 1e-6)
      const gesture = event as Event & { clientX?: number; clientY?: number }
      const rect = stage.getBoundingClientRect()
      zoomAtCursor(
        gesture.clientX ?? rect.left + rect.width / 2,
        gesture.clientY ?? rect.top + rect.height / 2,
        dolly,
      )
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      dragRef.current.pointerId = -1
      panningRef.current = false
      setPanning(false)
      setOrbiting(false)
      pinchRef.current = {
        start: touchDistance(event.touches),
        zoom: zoomRef.current,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || pinchRef.current.start <= 0) return
      event.preventDefault()
      event.stopPropagation()
      const scale = touchDistance(event.touches) / pinchRef.current.start
      const nextZoom = clampZoom(pinchRef.current.zoom * scale)
      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2
      const dolly =
        nextZoom === 0 ? 1 : zoomRef.current / Math.max(nextZoom, 1e-6)
      zoomAtCursor(midX, midY, dolly)
    }

    const fromNav = (event: Event) =>
      event.target instanceof Element &&
      event.target.closest('.hud-thumbnail-nav')

    const onPointerDown = (event: PointerEvent) => {
      if (fromNav(event) || event.button !== 0) return
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pan: panRef.current,
        orbit: { ...orbitRef.current },
        rotate: event.metaKey || event.ctrlKey,
      }
      stage.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return
      const dx = event.clientX - dragRef.current.x
      const dy = event.clientY - dragRef.current.y
      if (!panningRef.current) {
        if (Math.hypot(dx, dy) <= 3) return
        panningRef.current = true
        if (dragRef.current.rotate) setOrbiting(true)
        else setPanning(true)
      }
      if (dragRef.current.rotate) {
        const speed = (2 * Math.PI) / Math.max(stage.clientHeight, 1)
        const basePitch = sphericalFromOffset(
          cameraOffset(target.camera.position, target.camera.lookAt, 1),
        ).pitch
        orbitRef.current = {
          yaw: dragRef.current.orbit.yaw - dx * speed,
          pitch: clampOrbitPitch(
            basePitch,
            dragRef.current.orbit.pitch + dy * speed,
          ),
        }
        return
      }
      const { right, up, distance } = cameraPanBasis(
        target.camera.position,
        target.camera.lookAt,
        zoomRef.current,
        orbitRef.current,
      )
      const speed = distance / Math.max(stage.clientHeight, 1)
      panRef.current = vecAdd(
        dragRef.current.pan,
        vecAdd(vecScale(right, -dx * speed), vecScale(up, dy * speed)),
      )
    }

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return
      dragRef.current.pointerId = -1
      panningRef.current = false
      setPanning(false)
      setOrbiting(false)
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId)
      }
    }

    const onDoubleClick = (event: MouseEvent) => {
      if (fromNav(event)) return
      event.preventDefault()
      zoomRef.current = 1
      panRef.current = ZERO_PAN
      orbitRef.current = ZERO_ORBIT
      setZoom(1)
    }

    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    stage.addEventListener('gesturestart', onGestureStart, { capture: true })
    stage.addEventListener('gesturechange', onGestureChange, { capture: true })
    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerup', onPointerUp)
    stage.addEventListener('pointercancel', onPointerUp)
    stage.addEventListener('dblclick', onDoubleClick)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      stage.removeEventListener('gesturestart', onGestureStart, { capture: true })
      stage.removeEventListener('gesturechange', onGestureChange, { capture: true })
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove, { capture: true })
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', onPointerUp)
      stage.removeEventListener('pointercancel', onPointerUp)
      stage.removeEventListener('dblclick', onDoubleClick)
    }
  }, [minimized, target])

  useEffect(() => {
    if (!maximized) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      onMaximize?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [maximized, onMaximize])

  if (!target) return null

  return (
    <div
      className="hud-thumbnail"
      data-minimized={minimized}
      data-maximized={maximized}
    >
      <div className="hud-thumbnail-bar">
        <span>3D view</span>
        <div className="hud-panel-controls">
          {onMinimize && !maximized && (
            <button
              className="hud-button hud-icon-button hud-panel-control"
              type="button"
              aria-label={minimized ? 'Restore 3D view' : 'Minimize 3D view'}
              onClick={onMinimize}
            >
              {minimized ? '+' : '−'}
            </button>
          )}
          {onMaximize && (
            <button
              className="hud-button hud-icon-button hud-panel-control"
              type="button"
              aria-label={maximized ? 'Minimize 3D view' : 'Maximize 3D view'}
              onClick={onMaximize}
            >
              {maximized ? '−' : '□'}
            </button>
          )}
          <button
            className="hud-button hud-icon-button hud-panel-control"
            type="button"
            aria-label="Close 3D view"
            onClick={onHide}
          >
            ×
          </button>
        </div>
      </div>
      {!minimized && (
      <div
        className="hud-thumbnail-stage"
        ref={stageRef}
        data-panning={panning}
        data-orbiting={orbiting}
      >
        <Canvas
          shadows={false}
          dpr={[1, 1.5]}
          resize={{ offsetSize: true }}
          gl={{ antialias: true, toneMappingExposure: 1.25 }}
          camera={{
            fov: 50,
            near: 0.1,
            far: 400,
            position: target.camera.position,
          }}
        >
          <ThumbnailScene
            graph={graph}
            layout={layout}
            importedBy={importedBy}
            target={target}
            highlightedFolders={highlightedFolders}
            planned={planned}
            created={created}
            deleted={deleted}
            zoom={zoom}
            zoomRef={zoomRef}
            panRef={panRef}
            orbitRef={orbitRef}
            cameraRef={cameraRef}
            frozenRef={panningRef}
            visibleLabelIds={visibleLabelIds}
            onVisibleLabels={setVisibleLabelIds}
          />
        </Canvas>
        <div className="hud-thumbnail-hint">
          Scroll zoom · drag pan · ⌘ drag rotate
        </div>
        <div className="hud-thumbnail-nav">
          <button
            className="hud-button hud-icon-button"
            type="button"
            aria-label="Zoom out"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const rect = stageRef.current?.getBoundingClientRect()
              if (!rect) return
              zoomAtCursorRef.current(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                1 / ZOOM_SCALE,
              )
            }}
          >
            −
          </button>
          <button
            className="hud-button hud-icon-button"
            type="button"
            aria-label="Zoom in"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const rect = stageRef.current?.getBoundingClientRect()
              if (!rect) return
              zoomAtCursorRef.current(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                ZOOM_SCALE,
              )
            }}
          >
            +
          </button>
        </div>
      </div>
      )}
    </div>
  )
}
