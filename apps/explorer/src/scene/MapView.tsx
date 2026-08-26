import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, MapControls, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { folderAt, worldBounds } from '../layout'
import type { ChangeKind } from '../theme'
import type { PlacedFolder, WorldLayout } from '../types'

export type MapBlueprintMenu = {
  x: number
  y: number
  folder: string
}

type MapViewProps = {
  layout: WorldLayout
  enabled: boolean
  marker: [number, number] | null
  highlightedFolders?: Partial<Record<string, ChangeKind>>
  selectedFolder?: string | null
  namingFolderPath?: string | null
  onLand: (x: number, z: number) => void
  onSelect: (fileId: string | null) => void
  onSelectFolder: (folderPath: string | null) => void
  onTravelTo: (fromId: string, toId: string) => void
  onBlueprintMenu?: (menu: MapBlueprintMenu) => void
}

export function MapView({
  layout,
  enabled,
  marker,
  highlightedFolders,
  selectedFolder = null,
  namingFolderPath = null,
  onLand,
  onSelect,
  onSelectFolder,
  onTravelTo,
  onBlueprintMenu,
}: MapViewProps) {
  const size = useThree((state) => state.size)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const scene = useThree((state) => state.scene)
  const bounds = useMemo(() => worldBounds(layout), [layout])
  const drag = useRef({ x: 0, y: 0, moved: false, active: false })
  const sized = size.width > 16 && size.height > 16
  const hudReserve = 88
  const topReserve = 28
  const viewWidth = Math.max(size.width, 1)
  const viewHeight = Math.max(size.height - hudReserve - topReserve, 1)

  const fitZoom = sized
    ? Math.min(
        viewWidth / Math.max(bounds.width + 36, 1),
        viewHeight / Math.max(bounds.depth + 36, 1),
      )
    : 8
  const zoom = Math.max(fitZoom * 0.92, 0.08)
  // Ortho up is -Z, so +Z is down the screen. Shift the view so the map sits
  // above the bottom HUD instead of centering under it.
  const cz = bounds.cz + hudReserve / 2 / zoom
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void }>(null)

  useLayoutEffect(() => {
    if (!enabled || !(camera instanceof THREE.OrthographicCamera)) return
    camera.up.set(0, 0, -1)
    camera.position.set(bounds.cx, 120, cz)
    camera.lookAt(bounds.cx, 0, cz)
    camera.near = 1
    camera.far = 2000
    camera.zoom = zoom
    camera.updateProjectionMatrix()
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(bounds.cx, 0, cz)
      controls.update()
    }
  }, [bounds.cx, camera, cz, enabled, sized, zoom])

  useEffect(() => {
    if (!enabled) return
    const element = gl.domElement
    element.style.cursor = 'grab'

    const isWalkClick = (event: PointerEvent | MouseEvent) => event.altKey

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
      const fileHit = hits.find((hit) => hit.object.userData.fileId)
      return { raycaster, relationHit, fileHit }
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
      const { raycaster, relationHit, fileHit } = pick
      if (fileHit) return false

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
      element.style.cursor = 'grab'
      const startedOnCanvas = drag.current.active
      drag.current.active = false
      if (!startedOnCanvas || !isWalkButton(event) || drag.current.moved) return

      if (isWalkClick(event) && landAtPointer(event.clientX, event.clientY, true)) {
        return
      }

      const pick = pickAt(event.clientX, event.clientY)
      if (!pick) return
      const { relationHit, fileHit } = pick
      if (fileHit) {
        onSelect(fileHit.object.userData.fileId as string)
        return
      }
      if (relationHit) {
        onTravelTo(
          relationHit.object.userData.relationFrom as string,
          relationHit.object.userData.relationTo as string,
        )
        return
      }

      const hit = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      if (pick.raycaster.ray.intersectPlane(plane, hit)) {
        const folder = folderAt(hit.x, hit.z, layout)
        if (folder) {
          onSelectFolder(folder.path)
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
      if (!pick.raycaster.ray.intersectPlane(plane, hit)) return
      const folder =
        folderAt(hit.x, hit.z, layout) ??
        (selectedFolder ? layout.folders[selectedFolder] : undefined) ??
        layout.folders['.']
      if (!folder) return
      onSelectFolder(folder.path)
      onBlueprintMenu({
        x: event.clientX,
        y: event.clientY,
        folder: folder.path,
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
      const overlay = document.elementFromPoint(event.clientX, event.clientY)
      if (overlay?.closest('.hud-thumbnail')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
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
    onLand,
    onBlueprintMenu,
    onSelect,
    onSelectFolder,
    onTravelTo,
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
        />
      )}
      {enabled && marker && <LandMarker marker={marker} />}
    </>
  )
}

const PROJECT = new THREE.Vector3()
const MIN_FOLDER_LABEL_PX = 28
const FOLDER_ENTRANCE_Z = 1.35

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

function folderLabelClass(
  folder: PlacedFolder,
  highlightedFolders: Partial<Record<string, ChangeKind>> | undefined,
  selectedFolder: string | null,
) {
  return [
    'map-folder-label',
    highlightedFolders?.[folder.path]
      ? `map-folder-label-${highlightedFolders[folder.path]}`
      : folder.added
        ? 'map-folder-label-added'
        : selectedFolder === folder.path
          ? 'map-folder-label-selected'
          : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function MapFolderLabels({
  folders,
  highlightedFolders,
  selectedFolder,
  namingFolderPath,
}: {
  folders: Record<string, PlacedFolder>
  highlightedFolders?: Partial<Record<string, ChangeKind>>
  selectedFolder: string | null
  namingFolderPath: string | null
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const items = useMemo(() => Object.values(folders), [folders])

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const layer = document.createElement('div')
    layer.className = 'map-folder-label-layer'
    layer.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:80;background:transparent;'
    for (const folder of items) {
      const el = document.createElement('div')
      el.className = folderLabelClass(folder, highlightedFolders, selectedFolder)
      el.style.position = 'absolute'
      el.style.top = '0'
      el.style.left = '0'
      el.style.visibility = 'hidden'
      const name = document.createElement('span')
      name.className = 'map-folder-name'
      name.textContent = folderKindLabel(
        folder.name,
        highlightedFolders?.[folder.path] ?? null,
        folder.added ?? false,
      )
      el.appendChild(name)
      layer.appendChild(el)
    }
    parent.appendChild(layer)
    layerRef.current = layer
    return () => {
      layer.remove()
      layerRef.current = null
    }
  }, [gl, highlightedFolders, items, selectedFolder])

  useFrame(() => {
    const layer = layerRef.current
    if (!layer) return
    const zoom = 'zoom' in camera ? Number(camera.zoom) : 1
    const nodes = layer.children
    for (let i = 0; i < items.length; i += 1) {
      const el = nodes[i] as HTMLElement | undefined
      const folder = items[i]
      if (!el || !folder) continue
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
      const span = Math.max(folder.width, folder.depth) * zoom
      const force =
        selectedFolder === folder.path ||
        Boolean(highlightedFolders?.[folder.path] || folder.added)
      const onScreen =
        !screen.behind &&
        x > -120 &&
        x < size.width + 120 &&
        y > -40 &&
        y < size.height + 40
      if (
        folder.path === namingFolderPath ||
        !onScreen ||
        (!force && span < MIN_FOLDER_LABEL_PX)
      ) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      const tx = Math.round(x)
      const ty = Math.round(y)
      const next = `${tx},${ty}`
      if (el.dataset.pos !== next) {
        el.dataset.pos = next
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
