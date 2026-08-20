import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  fileChangeKind,
  filesImporting,
  folderAt,
  folderChangeHighlights,
  folderOfFile,
} from '../layout'
import { CONFIG, WORLD_VOID, type ChangeKind } from '../theme'
import type { CodebaseGraph, PlacedFile, PlacedFolder, WorldLayout } from '../types'
import { FileBlock } from './FileBlock'
import { FolderArea } from './FolderArea'
import { RelationLines } from './RelationLines'

type SelectionThumbnailProps = {
  graph: CodebaseGraph
  layout: WorldLayout
  selectedId: string | null
  selectedFolder: string | null
  landAt: [number, number]
  importedBy?: boolean
  minimized?: boolean
  plannedIds?: string[]
  createdIds?: string[]
  deletedIds?: string[]
  onMinimize?: () => void
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

const MIN_ZOOM = 0.55
const MAX_ZOOM = 3.4

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
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
  zoom,
}: {
  position: [number, number, number]
  lookAt: [number, number, number]
  zoom: number
}) {
  const { camera } = useThree()
  const aim = () => {
    const scale = 1 / zoom
    camera.up.set(0, 1, 0)
    camera.position.set(
      lookAt[0] + (position[0] - lookAt[0]) * scale,
      lookAt[1] + (position[1] - lookAt[1]) * scale,
      lookAt[2] + (position[2] - lookAt[2]) * scale,
    )
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2])
    camera.updateProjectionMatrix()
  }

  useLayoutEffect(aim, [camera, lookAt, position, zoom])
  useFrame(aim)
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
}) {
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
        zoom={zoom}
      />
      <FolderArea
        folder={target.folder}
        highlightKind={highlightedFolders[target.folder.path] ?? null}
        previewLabels
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
  plannedIds = [],
  createdIds = [],
  deletedIds = [],
  onMinimize,
  onHide,
}: SelectionThumbnailProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const pinchRef = useRef({ start: 0, zoom: 1 })
  const [zoom, setZoom] = useState(1)
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

  useEffect(() => {
    setZoom(1)
    zoomRef.current = 1
  }, [selectedId, selectedFolder, landAt])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || minimized) return

    const applyZoom = (next: number) => {
      const clamped = clampZoom(next)
      zoomRef.current = clamped
      setZoom(clamped)
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      applyZoom(zoomRef.current * Math.exp(-event.deltaY * 0.01))
    }

    const onGestureStart = (event: Event) => {
      event.preventDefault()
      pinchRef.current.zoom = zoomRef.current
    }

    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const scale = Number((event as Event & { scale?: number }).scale)
      if (!Number.isFinite(scale) || scale <= 0) return
      applyZoom(pinchRef.current.zoom * scale)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      pinchRef.current = {
        start: touchDistance(event.touches),
        zoom: zoomRef.current,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || pinchRef.current.start <= 0) return
      event.preventDefault()
      event.stopPropagation()
      applyZoom(
        pinchRef.current.zoom *
          (touchDistance(event.touches) / pinchRef.current.start),
      )
    }

    stage.addEventListener('wheel', onWheel, { passive: false, capture: true })
    stage.addEventListener('gesturestart', onGestureStart, { capture: true })
    stage.addEventListener('gesturechange', onGestureChange, { capture: true })
    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    return () => {
      stage.removeEventListener('wheel', onWheel, { capture: true })
      stage.removeEventListener('gesturestart', onGestureStart, { capture: true })
      stage.removeEventListener('gesturechange', onGestureChange, { capture: true })
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove, { capture: true })
    }
  }, [minimized])

  if (!target) return null

  return (
    <div className="hud-thumbnail" data-minimized={minimized}>
      <div className="hud-thumbnail-bar">
        <span>3D view</span>
        <div className="hud-panel-controls">
          {onMinimize && (
            <button
              className="hud-button hud-icon-button hud-panel-control"
              type="button"
              aria-label={minimized ? 'Restore 3D view' : 'Minimize 3D view'}
              onClick={onMinimize}
            >
              {minimized ? '+' : '−'}
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
      <div className="hud-thumbnail-stage" ref={stageRef}>
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
          />
        </Canvas>
      </div>
      )}
    </div>
  )
}
