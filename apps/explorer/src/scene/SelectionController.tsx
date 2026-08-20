import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { relationTravelTarget } from '../layout'
import type { AimedRelation, PlacedFile } from '../types'

type SelectionControllerProps = {
  locked: boolean
  files: Record<string, PlacedFile>
  onSelect: (fileId: string | null) => void
  onInspect?: (fileId: string) => void
  onAimFile?: (fileId: string | null) => void
  onAimRelation?: (aim: AimedRelation | null) => void
  onTravelTo: (fromId: string, toId: string) => void
}

const ndc = new THREE.Vector2(0, 0)
const raycaster = new THREE.Raycaster()

function aimedRelation(
  hits: THREE.Intersection[],
  origin: THREE.Vector3,
  files: Record<string, PlacedFile>,
): AimedRelation | null {
  const relation = hits.find((item) => item.object.userData.relationTo)
  const file = hits.find((item) => item.object.userData.fileId)
  if (!relation || (file && relation.distance > file.distance + 0.4)) return null
  const fromId = relation.object.userData.relationFrom as string
  const toId = relation.object.userData.relationTo as string
  return {
    from: fromId,
    to: toId,
    flyTo: relationTravelTarget(fromId, toId, origin.x, origin.z, files),
  }
}

function aimKey(aim: AimedRelation | null) {
  return aim ? `${aim.from}->${aim.to}:${aim.flyTo}` : ''
}

function aimedFileId(hits: THREE.Intersection[]): string | null {
  const file = hits.find((item) => item.object.userData.fileId)
  return file ? (file.object.userData.fileId as string) : null
}

export function SelectionController({
  locked,
  files,
  onSelect,
  onInspect,
  onAimFile,
  onAimRelation,
  onTravelTo,
}: SelectionControllerProps) {
  const { camera, scene } = useThree()
  const lastAim = useRef('')
  const lastAimedFile = useRef<string | null>(null)

  useFrame(() => {
    if (!onAimRelation && !onAimFile) return
    if (!locked) {
      if (lastAim.current) {
        lastAim.current = ''
        onAimRelation?.(null)
      }
      if (lastAimedFile.current) {
        lastAimedFile.current = null
        onAimFile?.(null)
      }
      return
    }
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(scene.children, true)
    const next = aimedRelation(hits, camera.position, files)
    const key = aimKey(next)
    if (onAimRelation && key !== lastAim.current) {
      lastAim.current = key
      onAimRelation(next)
    }
    const fileId = aimedFileId(hits)
    if (onAimFile && fileId !== lastAimedFile.current) {
      lastAimedFile.current = fileId
      onAimFile(fileId)
    }
  })

  useEffect(() => {
    let travelTimer: number | undefined

    const onClick = (event: MouseEvent) => {
      if (!locked) return
      if (event.detail > 1) {
        if (travelTimer) window.clearTimeout(travelTimer)
        return
      }
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(scene.children, true)
      const aim = aimedRelation(hits, camera.position, files)
      if (aim) {
        travelTimer = window.setTimeout(() => {
          travelTimer = undefined
          onTravelTo(aim.from, aim.to)
        }, 280)
        return
      }
      const fileId = aimedFileId(hits)
      onSelect(fileId)
    }

    const onDblClick = () => {
      if (travelTimer) window.clearTimeout(travelTimer)
      if (!locked) return
      raycaster.setFromCamera(ndc, camera)
      const fileId = aimedFileId(raycaster.intersectObjects(scene.children, true))
      if (!fileId) return
      onSelect(fileId)
      onInspect?.(fileId)
    }

    window.addEventListener('click', onClick)
    window.addEventListener('dblclick', onDblClick)
    return () => {
      if (travelTimer) window.clearTimeout(travelTimer)
      window.removeEventListener('click', onClick)
      window.removeEventListener('dblclick', onDblClick)
    }
  }, [camera, files, locked, onInspect, onSelect, onTravelTo, scene])

  return null
}
