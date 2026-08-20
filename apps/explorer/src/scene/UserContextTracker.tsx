import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { folderAt } from '../layout'
import { fileById, toFileRef } from '../userContext'
import { namedCreatedBlocks, namedCreatedIslands } from '../userCreated'
import type { CodebaseGraph, UserContext, UserCreatedBlock, UserCreatedIsland, UserFileRef, ViewMode, WorldLayout } from '../types'

type UserContextTrackerProps = {
  graph: CodebaseGraph
  layout: WorldLayout
  mode: ViewMode
  selectedId: string | null
  userCreatedBlocks?: UserCreatedBlock[]
  userCreatedIslands?: UserCreatedIsland[]
  onContext: (context: UserContext) => void
}

const ndc = new THREE.Vector2(0, 0)
const raycaster = new THREE.Raycaster()
const look = new THREE.Vector3()
const toward = new THREE.Vector3()

function filesOnIsland(graph: CodebaseGraph, islandPath: string | null): UserFileRef[] {
  if (!islandPath) return []
  const folder = graph.folders.find((item) => item.path === islandPath)
  if (!folder) return []
  return folder.files
    .map((id) => fileById(graph, id))
    .filter((file): file is NonNullable<typeof file> => Boolean(file))
    .map(toFileRef)
}

function filesInLookDirection(
  graph: CodebaseGraph,
  layout: WorldLayout,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): UserFileRef[] {
  const seen: { score: number; file: UserFileRef }[] = []

  for (const file of graph.files) {
    const placed = layout.files[file.id]
    if (!placed) continue
    toward.set(placed.position[0], placed.position[1], placed.position[2]).sub(origin)
    const distance = toward.length()
    if (distance > 24 || distance < 0.35) continue
    toward.y = 0
    if (toward.lengthSq() === 0) continue
    toward.normalize()
    const alignment = toward.dot(direction)
    if (alignment < 0.62) continue
    seen.push({
      score: alignment * 8 - distance * 0.08,
      file: toFileRef(file),
    })
  }

  seen.sort((a, b) => b.score - a.score)
  return seen.slice(0, 8).map((item) => item.file)
}

export function UserContextTracker({
  graph,
  layout,
  mode,
  selectedId,
  userCreatedBlocks = [],
  userCreatedIslands = [],
  onContext,
}: UserContextTrackerProps) {
  const { camera, scene } = useThree()
  const lastKey = useRef('')

  const lastIsland = useRef<ReturnType<typeof folderAt>>(null)

  useFrame(() => {
    try {
      const walking = mode === 'walk'
      const island = walking
        ? folderAt(camera.position.x, camera.position.z, layout)
        : lastIsland.current
      if (walking && island) lastIsland.current = island

      let lookingAtId: string | null = selectedId
      if (walking) {
        raycaster.setFromCamera(ndc, camera)
        const hit = raycaster
          .intersectObjects(scene.children, true)
          .find((item) => item.object.userData.fileId)
        lookingAtId = hit ? (hit.object.userData.fileId as string) : null
      }

      camera.getWorldDirection(look)
      look.y = 0
      if (look.lengthSq() > 0) look.normalize()

      const gazed = fileById(graph, lookingAtId)
      const lookingAtFiles = walking
        ? filesInLookDirection(graph, layout, camera.position, look)
        : gazed
          ? [toFileRef(gazed)]
          : []

      const lookingAt = gazed ?? fileById(graph, lookingAtFiles[0]?.id ?? null)
      const selected = fileById(graph, selectedId)
      const islandPath = island?.path ?? selected?.folder ?? null
      const islandName =
        island?.name ??
        graph.folders.find((folder) => folder.path === islandPath)?.name ??
        'open ground'

      const namedBlocks = namedCreatedBlocks(userCreatedBlocks)
      const namedIslands = namedCreatedIslands(userCreatedIslands)
      const key = [
        mode,
        islandPath ?? '',
        lookingAt?.id ?? '',
        selected?.id ?? '',
        lookingAtFiles.map((file) => file.id).join(','),
        namedBlocks.map((block) => block.id).join(','),
        namedIslands.map((island) => island.id).join(','),
      ].join('|')

      if (key === lastKey.current) return
      lastKey.current = key

      onContext({
        updatedAt: new Date().toISOString(),
        mode,
        island: {
          path: islandPath,
          name: islandName,
        },
        lookingAt: lookingAt ? toFileRef(lookingAt) : null,
        lookingAtFiles,
        selected: selected ? toFileRef(selected) : null,
        filesOnIsland: filesOnIsland(graph, islandPath),
        position: {
          x: Number(camera.position.x.toFixed(2)),
          z: Number(camera.position.z.toFixed(2)),
        },
        userCreatedBlocks: namedBlocks,
        userCreatedIslands: namedIslands,
      })
    } catch {
      // Context tracking must never stop the render loop.
    }
  })

  return null
}
