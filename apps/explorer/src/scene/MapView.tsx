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

  const fitZoom = sized
    ? Math.min(
        size.width / Math.max(bounds.width + 24, 1),
        size.height / Math.max(bounds.depth + 24, 1),
      )
    : 8
  const zoom = Math.max(fitZoom * 0.92, 1)

  useLayoutEffect(() => {
    if (!enabled || !(camera instanceof THREE.OrthographicCamera)) return
    camera.up.set(0, 0, -1)
    camera.position.set(bounds.cx, 120, bounds.cz)
    camera.lookAt(bounds.cx, 0, bounds.cz)
    camera.near = 1
    camera.far = 2000
    camera.zoom = zoom
    camera.updateProjectionMatrix()
  }, [bounds.cx, bounds.cz, camera, enabled, zoom])

  useEffect(() => {
    if (!enabled) return
    const element = gl.domElement
    element.style.cursor = 'grab'

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
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

    const onUp = (event: PointerEvent) => {
      element.style.cursor = 'grab'
      const startedOnCanvas = drag.current.active
      drag.current.active = false
      if (!startedOnCanvas || event.button !== 0 || drag.current.moved) return

      const pick = pickAt(event.clientX, event.clientY)
      if (!pick) return
      const { relationHit, fileHit } = pick
      if (
        relationHit &&
        (!fileHit || relationHit.distance <= fileHit.distance + 0.4)
      ) {
        onTravelTo(
          relationHit.object.userData.relationFrom as string,
          relationHit.object.userData.relationTo as string,
        )
        return
      }
      if (fileHit) {
        onSelect(fileHit.object.userData.fileId as string)
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

    const onDblClick = (event: MouseEvent) => {
      if (event.button !== 0 || drag.current.moved) return
      const pick = pickAt(event.clientX, event.clientY)
      if (!pick) return
      const { raycaster, relationHit, fileHit } = pick
      if (relationHit || fileHit) return

      const hit = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const lock = element.requestPointerLock()
        if (lock && typeof lock.catch === 'function') {
          void lock.catch(() => {})
        }
        onLand(hit.x, hit.z)
      }
    }

    element.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    element.addEventListener('dblclick', onDblClick)
    return () => {
      element.style.cursor = ''
      element.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      element.removeEventListener('dblclick', onDblClick)
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
          position={[bounds.cx, 120, bounds.cz]}
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
          minZoom={Math.max(fitZoom * 0.45, 1)}
          maxZoom={Math.max(fitZoom * 10, 20)}
          target={[bounds.cx, 0, bounds.cz]}
        />
      )}
      {enabled &&
        Object.values(layout.folders).map((folder) => (
          <Html
            key={folder.path}
            position={[folder.x, 14, folder.z + 1.35]}
            center
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
