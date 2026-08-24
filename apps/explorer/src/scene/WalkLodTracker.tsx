import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlacedBridge, PlacedFile, PlacedFolder } from '../types'
import {
  computeWalkLod,
  sameWalkLod,
  walkLodCell,
  type WalkLod,
} from './walkLod'

const look = new THREE.Vector3()

type WalkLodTrackerProps = {
  files: Record<string, PlacedFile>
  folders: Record<string, PlacedFolder>
  bridges: PlacedBridge[]
  keepFileIds: Set<string>
  keepFolderPaths: Set<string>
  origin: [number, number]
  onChange: (lod: WalkLod) => void
}

export function WalkLodTracker({
  files,
  folders,
  bridges,
  keepFileIds,
  keepFolderPaths,
  origin,
  onChange,
}: WalkLodTrackerProps) {
  const { camera } = useThree()
  const prev = useRef<WalkLod | null>(null)
  const cell = useRef('')
  const keepFilesRef = useRef(keepFileIds)
  const keepFoldersRef = useRef(keepFolderPaths)
  const filesRef = useRef(files)
  const foldersRef = useRef(folders)
  const bridgesRef = useRef(bridges)
  const onChangeRef = useRef(onChange)
  keepFilesRef.current = keepFileIds
  keepFoldersRef.current = keepFolderPaths
  filesRef.current = files
  foldersRef.current = folders
  bridgesRef.current = bridges
  onChangeRef.current = onChange

  const publish = (x: number, z: number, y: number, lookX: number, lookZ: number) => {
    const next = computeWalkLod({
      x,
      z,
      y,
      lookX,
      lookZ,
      files: filesRef.current,
      folders: foldersRef.current,
      bridges: bridgesRef.current,
      keepFileIds: keepFilesRef.current,
      keepFolderPaths: keepFoldersRef.current,
      prev: prev.current,
    })
    if (sameWalkLod(prev.current, next)) return
    prev.current = next
    onChangeRef.current(next)
  }

  const keepKey = `${[...keepFileIds].join('|')}|${[...keepFolderPaths].join('|')}`

  useLayoutEffect(() => {
    camera.getWorldDirection(look)
    const lx = look.x
    const lz = look.z
    if (Math.hypot(lx, lz) < 0.001) {
      publish(origin[0], origin[1], camera.position.y, 0, 1)
      return
    }
    publish(camera.position.x, camera.position.z, camera.position.y, lx, lz)
  }, [bridges, camera, files, folders, keepKey, origin])

  useFrame(() => {
    camera.getWorldDirection(look)
    const lx = look.x
    const lz = look.z
    const nextCell = `${walkLodCell(camera.position.x, camera.position.z, camera.position.y, lx, lz)}:${keepKey}`
    if (nextCell === cell.current) return
    cell.current = nextCell
    publish(camera.position.x, camera.position.z, camera.position.y, lx, lz)
  })

  return null
}
