import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Html, MapControls, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { folderAt, worldBounds } from '../layout'
import type { ChangeKind } from '../theme'
import type { WorldLayout } from '../types'

type MapViewProps = {
  layout: WorldLayout
  enabled: boolean
  marker: [number, number] | null
  highlightedFolders?: Partial<Record<string, ChangeKind>>
  selectedFolder?: string | null
  onLand: (x: number, z: number) => void
  onSelect: (fileId: string | null) => void
  onSelectFolder: (folderPath: string | null) => void
  onTravelTo: (fromId: string, toId: string) => void
}

export function MapView({
  layout,
  enabled,
  marker,
  highlightedFolders,
  selectedFolder = null,
  onLand,
  onSelect,
  onSelectFolder,
  onTravelTo,
}: MapViewProps) {
  const size = useThree((state) => state.size)
  const { camera, gl, scene } = useThree()
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
  const target = useMemo(() => [bounds.cx, 0, cz] as [number, number, number], [bounds.cx, cz])

  useLayoutEffect(() => {
    if (!enabled || !(camera instanceof THREE.OrthographicCamera)) return
    camera.up.set(0, 0, -1)
    camera.position.set(bounds.cx, 120, cz)
    camera.lookAt(bounds.cx, 0, cz)
    camera.near = 1
    camera.far = 2000
    camera.zoom = zoom
    camera.updateProjectionMatrix()
  }, [bounds.cx, camera, cz, enabled, zoom])

  useEffect(() => {
    if (!enabled) return
    const element = gl.domElement
    element.style.cursor = 'grab'

    const isWalkClick = (event: PointerEvent | MouseEvent) => event.ctrlKey

    const isWalkButton = (event: PointerEvent) =>
      event.button === 0 || (event.ctrlKey && event.button === 2)

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
      if (event.ctrlKey) event.preventDefault()
    }

    element.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    element.addEventListener('contextmenu', onContextMenu)
    return () => {
      element.style.cursor = ''
      element.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      element.removeEventListener('contextmenu', onContextMenu)
    }
  }, [
    camera,
    enabled,
    gl.domElement,
    layout,
    onLand,
    onSelect,
    onSelectFolder,
    onTravelTo,
    scene,
  ])

  return (
    <>
      {enabled && (
        <OrthographicCamera
          makeDefault
          position={[bounds.cx, 120, cz]}
          zoom={zoom}
          near={1}
          far={2000}
          up={[0, 0, -1]}
        />
      )}
      {enabled && sized && (
        <MapControls
          enableRotate={false}
          enableDamping
          dampingFactor={0.12}
          screenSpacePanning
          zoomSpeed={1.15}
          minZoom={Math.max(fitZoom * 0.35, 0.05)}
          maxZoom={Math.max(fitZoom * 10, 20)}
          target={target}
        />
      )}
      {enabled &&
        Object.values(layout.folders).map((folder) => (
          <Html
            key={folder.path}
            position={[folder.x, 14, folder.z + 1.35]}
            center
            zIndexRange={[1, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={[
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
                .join(' ')}
            >
              <span className="map-folder-name">
                {folderKindLabel(
                  folder.name,
                  highlightedFolders?.[folder.path] ?? null,
                  folder.added ?? false,
                )}
              </span>
            </div>
          </Html>
        ))}
      {marker && <LandMarker marker={marker} />}
    </>
  )
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
  return (
    <group position={[marker[0], 0.2, marker[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.85, 24]} />
        <meshBasicMaterial color="#e8c36a" side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
