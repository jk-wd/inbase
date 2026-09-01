import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapBoxItem, MapPlaneItem } from './collectMapBatches'

const DUMMY = new THREE.Object3D()
const COLOR = new THREE.Color()
const skipRaycast = () => {}

function useInstanceCap(count: number) {
  const cap = useRef(Math.max(count, 1))
  if (count > cap.current) cap.current = count
  return cap.current
}

function splitByOpacity<T extends { opacity: number }>(items: T[]) {
  const solid: T[] = []
  const faded: T[] = []
  for (const item of items) {
    if (item.opacity < 1) faded.push(item)
    else solid.push(item)
  }
  return { solid, faded }
}

function MapInstancedBoxes({
  items,
  opacity = 1,
}: {
  items: MapBoxItem[]
  opacity?: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const cap = useInstanceCap(items.length)
  const ids = useMemo(() => items.map((item) => item.id), [items])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      DUMMY.position.set(item.position[0], item.position[1], item.position[2])
      DUMMY.rotation.set(0, 0, 0)
      DUMMY.scale.set(item.size[0], item.size[1], item.size[2])
      DUMMY.updateMatrix()
      mesh.setMatrixAt(i, DUMMY.matrix)
      mesh.setColorAt(i, COLOR.set(item.color))
    }
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.userData.mapFileIds = ids
  }, [ids, items])

  if (items.length === 0) return null
  return (
    <instancedMesh
      key={cap}
      ref={meshRef}
      args={[undefined, undefined, cap]}
      frustumCulled={false}
      userData={{ mapFileIds: ids }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        toneMapped={false}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
    </instancedMesh>
  )
}

function MapInstancedPlanes({
  items,
  opacity = 1,
  userDataKey,
  pick = false,
}: {
  items: MapPlaneItem[]
  opacity?: number
  userDataKey?: 'mapFolderPaths'
  pick?: boolean
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const cap = useInstanceCap(items.length)
  const ids = useMemo(() => items.map((item) => item.id), [items])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      DUMMY.position.set(item.x, item.y, item.z)
      DUMMY.rotation.set(-Math.PI / 2, 0, 0)
      DUMMY.scale.set(item.width, item.depth, 1)
      DUMMY.updateMatrix()
      mesh.setMatrixAt(i, DUMMY.matrix)
      mesh.setColorAt(i, COLOR.set(item.color))
    }
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    if (userDataKey) mesh.userData[userDataKey] = ids
  }, [ids, items, userDataKey])

  if (items.length === 0) return null
  return (
    <instancedMesh
      key={cap}
      ref={meshRef}
      args={[undefined, undefined, cap]}
      frustumCulled={false}
      {...(pick ? {} : { raycast: skipRaycast })}
      userData={userDataKey ? { [userDataKey]: ids } : undefined}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
    </instancedMesh>
  )
}

export function MapBatches({
  files,
  floors,
  aisles,
  bridges,
}: {
  files: MapBoxItem[]
  floors: MapPlaneItem[]
  aisles: MapPlaneItem[]
  bridges: MapPlaneItem[]
}) {
  const fileParts = splitByOpacity(files)
  const floorParts = splitByOpacity(floors)
  const aisleParts = splitByOpacity(aisles)
  const bridgeParts = splitByOpacity(bridges)
  return (
    <group>
      <MapInstancedPlanes
        items={floorParts.solid}
        userDataKey="mapFolderPaths"
        pick
      />
      <MapInstancedPlanes
        items={floorParts.faded}
        opacity={floorParts.faded[0]?.opacity}
        userDataKey="mapFolderPaths"
        pick
      />
      <MapInstancedPlanes items={aisleParts.solid} />
      <MapInstancedPlanes items={aisleParts.faded} opacity={aisleParts.faded[0]?.opacity} />
      <MapInstancedPlanes items={bridgeParts.solid} />
      <MapInstancedPlanes items={bridgeParts.faded} opacity={bridgeParts.faded[0]?.opacity} />
      <MapInstancedBoxes items={fileParts.solid} />
      <MapInstancedBoxes items={fileParts.faded} opacity={fileParts.faded[0]?.opacity} />
    </group>
  )
}
