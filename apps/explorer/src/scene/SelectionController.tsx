import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { relationTravelTarget } from '../layout'
import type { AimedRelation, PlacedFile } from '../types'

type SelectionControllerProps = {
  locked: boolean
  files: Record<string, PlacedFile>
  onSelect: (fileId: string | null) => void
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

export function SelectionController({
  locked,
  files,
  onSelect,
  onAimRelation,
  onTravelTo,
}: SelectionControllerProps) {
  const { camera, scene } = useThree()
  const lastAim = useRef('')

  useFrame(() => {
    if (!onAimRelation) return
    if (!locked) {
      if (lastAim.current) {
        lastAim.current = ''
        onAimRelation(null)
      }
      return
    }
    raycaster.setFromCamera(ndc, camera)
    const next = aimedRelation(
      raycaster.intersectObjects(scene.children, true),
      camera.position,
      files,
    )
    const key = aimKey(next)
    if (key === lastAim.current) return
    lastAim.current = key
    onAimRelation(next)
  })

  useEffect(() => {
    const onClick = () => {
      if (!locked) return
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(scene.children, true)
      const aim = aimedRelation(hits, camera.position, files)
      if (aim) {
        onTravelTo(aim.from, aim.to)
        return
      }
      const file = hits.find((item) => item.object.userData.fileId)
      onSelect(file ? (file.object.userData.fileId as string) : null)
    }

    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [camera, files, locked, onSelect, onTravelTo, scene])

  return null
}
