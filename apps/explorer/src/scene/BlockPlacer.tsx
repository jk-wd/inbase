import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { folderAt } from '../layout'
import type { WorldLayout } from '../types'

type BlockPlacerProps = {
  enabled: boolean
  layout: WorldLayout
  onPlace: (spot: { x: number; z: number; folder: string }) => void
}

const ndc = new THREE.Vector2(0, 0)
const raycaster = new THREE.Raycaster()
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3()
const forward = new THREE.Vector3()

const PLACE_MIN = 3
const PLACE_MAX = 22

function typingInField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  )
}

function lookPoint(camera: THREE.Camera): { x: number; z: number } {
  raycaster.setFromCamera(ndc, camera)
  const reached = raycaster.ray.intersectPlane(ground, hit)
  camera.getWorldDirection(forward)
  forward.y = 0
  if (forward.lengthSq() === 0) forward.set(0, 0, 1)
  else forward.normalize()

  let x: number
  let z: number
  if (reached) {
    x = hit.x
    z = hit.z
  } else {
    x = camera.position.x + forward.x * 8
    z = camera.position.z + forward.z * 8
  }

  const dx = x - camera.position.x
  const dz = z - camera.position.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.001) {
    return {
      x: camera.position.x + forward.x * PLACE_MIN,
      z: camera.position.z + forward.z * PLACE_MIN,
    }
  }
  const clamped = Math.min(PLACE_MAX, Math.max(PLACE_MIN, distance))
  const scale = clamped / distance
  return {
    x: camera.position.x + dx * scale,
    z: camera.position.z + dz * scale,
  }
}

export function BlockPlacer({ enabled, layout, onPlace }: BlockPlacerProps) {
  const { camera } = useThree()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!enabled || event.repeat || event.code !== 'Space') return
      if (typingInField(event.target)) return
      event.preventDefault()
      const { x, z } = lookPoint(camera)
      const island =
        folderAt(x, z, layout) ??
        folderAt(camera.position.x, camera.position.z, layout)
      onPlace({ x, z, folder: island?.path ?? '.' })
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, enabled, layout, onPlace])

  return null
}
