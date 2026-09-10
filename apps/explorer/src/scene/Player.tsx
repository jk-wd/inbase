import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, PointerLockControls } from '@react-three/drei'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { CONFIG } from '../theme'
import { isKeyboardIsolated, shouldIgnoreShortcut } from '../keyboard'
import type { ViewMode } from '../types'

const aimNdc = new THREE.Vector2(0, 0)
const aimRay = new THREE.Raycaster()
const aimHit = new THREE.Vector3()
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

const JUMP_MAX = 220
const JUMP_STAND_BACK = 1.6

function jumpToCrosshair(camera: THREE.Camera, scene: THREE.Scene) {
  aimRay.setFromCamera(aimNdc, camera)
  const hits = aimRay.intersectObjects(scene.children, true)
  const mesh = hits.find((item) => {
    if (item.distance < 0.45 || item.distance > JUMP_MAX) return false
    if (item.object.userData.relationTo) return false
    return item.object instanceof THREE.Mesh
  })
  if (mesh) {
    aimHit.copy(mesh.point)
    const dir = aimRay.ray.direction
    const horiz = Math.hypot(dir.x, dir.z)
    if (horiz > 0.001) {
      aimHit.x -= (dir.x / horiz) * JUMP_STAND_BACK
      aimHit.z -= (dir.z / horiz) * JUMP_STAND_BACK
    }
  } else if (!aimRay.ray.intersectPlane(ground, aimHit)) {
    return
  }
  const dist = Math.hypot(
    aimHit.x - camera.position.x,
    aimHit.z - camera.position.z,
  )
  if (dist < 0.4 || dist > JUMP_MAX) return
  camera.position.set(aimHit.x, CONFIG.eyeHeight, aimHit.z)
}

type PlayerProps = {
  mode: ViewMode
  landAt: [number, number]
  locked: boolean
  lockEnabled?: boolean
  onLockedChange: (locked: boolean) => void
  onWalkPosition: (x: number, z: number) => void
  onExitWalk?: () => void
}

export function Player({
  mode,
  landAt,
  locked,
  lockEnabled = true,
  onLockedChange,
  onWalkPosition,
  onExitWalk,
}: PlayerProps) {
  const { camera, scene } = useThree()
  const walking = mode === 'walk'
  const keys = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  })
  const front = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3(0, 1, 0))
  const move = useRef(new THREE.Vector3())
  const controlsRef = useRef<PointerLockControlsImpl>(null)
  const capturedLook = useRef(false)
  const lookHeld = useRef(false)
  const selfUnlock = useRef(false)

  useLayoutEffect(() => {
    if (!walking) {
      capturedLook.current = false
      return
    }
    placeCamera(
      camera,
      new THREE.Vector3(landAt[0], CONFIG.eyeHeight, landAt[1]),
      new THREE.Vector3(landAt[0], CONFIG.eyeHeight, landAt[1] + 10),
    )
  }, [camera, landAt, walking])

  useEffect(() => {
    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (shouldIgnoreShortcut(event)) return
      if (event.code === 'KeyW' || event.code === 'ArrowUp') keys.current.forward = down
      if (event.code === 'KeyS' || event.code === 'ArrowDown') keys.current.back = down
      if (event.code === 'KeyA' || event.code === 'ArrowLeft') keys.current.left = down
      if (event.code === 'KeyD' || event.code === 'ArrowRight') keys.current.right = down
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') keys.current.sprint = down
    }

    const down = (event: KeyboardEvent) => onKey(event, true)
    const up = (event: KeyboardEvent) => onKey(event, false)
    const onJump = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Space') return
      if (shouldIgnoreShortcut(event)) return
      if (mode !== 'walk' || !locked) return
      event.preventDefault()
      jumpToCrosshair(camera, scene)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keydown', onJump)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keydown', onJump)
      window.removeEventListener('keyup', up)
    }
  }, [camera, locked, mode, scene])

  useEffect(() => {
    if (!walking || !lockEnabled) {
      selfUnlock.current = true
      controlsRef.current?.unlock()
      document.exitPointerLock()
      return
    }
    selfUnlock.current = false
    if (capturedLook.current) return
    const controls = controlsRef.current
    const element = controls?.domElement
    if (!controls || !element) return
    capturedLook.current = true
    if (element.ownerDocument.pointerLockElement === element) {
      controls.isLocked = true
      onLockedChange(true)
      return
    }
    controls.lock()
  }, [lockEnabled, onLockedChange, walking])

  useEffect(() => {
    if (!walking) return

    const looking = () =>
      Boolean(controlsRef.current?.isLocked || document.pointerLockElement)

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.detail !== 1) return
      lookHeld.current = looking()
    }

    const onDblClick = () => {
      if (!lookHeld.current) return
      selfUnlock.current = true
      controlsRef.current?.unlock()
      document.exitPointerLock()
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onDblClick)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDblClick)
    }
  }, [walking])

  useFrame((_, delta) => {
    try {
      if (walking && locked) {
        if (isKeyboardIsolated()) {
          keys.current.forward = false
          keys.current.back = false
          keys.current.left = false
          keys.current.right = false
          keys.current.sprint = false
        }
        camera.getWorldDirection(front.current)
        front.current.y = 0
        front.current.normalize()
        right.current.crossVectors(front.current, up.current).normalize()
        move.current.set(0, 0, 0)
        if (keys.current.forward) move.current.add(front.current)
        if (keys.current.back) move.current.sub(front.current)
        if (keys.current.right) move.current.add(right.current)
        if (keys.current.left) move.current.sub(right.current)
        if (move.current.lengthSq() > 0) {
          const speed = keys.current.sprint ? CONFIG.sprintSpeed : CONFIG.walkSpeed
          move.current.normalize().multiplyScalar(speed * delta)
          camera.position.add(move.current)
        }
        camera.position.y = CONFIG.eyeHeight
      }

      if (!walking) return
      onWalkPosition(camera.position.x, camera.position.z)
    } catch {
      // Movement must never stop the render loop.
    }
  })

  if (!walking) return null

  return (
    <>
      <PerspectiveCamera makeDefault fov={70} near={0.1} far={400} />
      <PlayerLight />
      <PointerLockControls
        ref={controlsRef}
        makeDefault
        selector=".stage canvas"
        enabled={lockEnabled}
        onLock={() => {
          if (!lockEnabled) {
            selfUnlock.current = true
            controlsRef.current?.unlock()
            document.exitPointerLock()
            onLockedChange(false)
            return
          }
          selfUnlock.current = false
          onLockedChange(true)
        }}
        onUnlock={() => {
          const fromSelf = selfUnlock.current
          selfUnlock.current = false
          onLockedChange(false)
          if (!fromSelf) onExitWalk?.()
        }}
      />
    </>
  )
}

function placeCamera(
  camera: THREE.Camera,
  position: THREE.Vector3,
  lookAt: THREE.Vector3,
) {
  camera.position.copy(position)
  camera.up.set(0, 1, 0)
  camera.lookAt(lookAt)
  camera.rotation.order = 'YXZ'
  if ('updateProjectionMatrix' in camera) {
    ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
  }
}

function PlayerLight() {
  const { camera } = useThree()
  const overhead = useRef<THREE.PointLight>(null)
  const look = useRef<THREE.PointLight>(null)
  const direction = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!overhead.current || !look.current) return

    overhead.current.position.copy(camera.position)
    overhead.current.position.y += 2.6

    camera.getWorldDirection(direction.current)
    look.current.position.copy(camera.position)
    look.current.position.addScaledVector(direction.current, 5)
    look.current.position.y = camera.position.y + 1.4
  })

  return (
    <>
      <pointLight
        ref={overhead}
        color="#f4f1e8"
        intensity={7.5}
        distance={26}
        decay={1.4}
      />
      <pointLight
        ref={look}
        color="#e4eef8"
        intensity={3.4}
        distance={18}
        decay={1.6}
      />
    </>
  )
}
