import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, PointerLockControls } from '@react-three/drei'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { CONFIG } from '../theme'
import { locationLabel } from '../layout'
import type { FlyTo, ViewMode, WorldLayout } from '../types'

type PlayerProps = {
  layout: WorldLayout
  mode: ViewMode
  landAt: [number, number]
  locked: boolean
  lockEnabled?: boolean
  onLockedChange: (locked: boolean) => void
  onFolderChange: (label: string) => void
  onWalkPosition: (x: number, z: number) => void
  flyTo: FlyTo | null
}

export function Player({
  layout,
  mode,
  landAt,
  locked,
  lockEnabled = true,
  onLockedChange,
  onFolderChange,
  onWalkPosition,
  flyTo,
}: PlayerProps) {
  const { camera } = useThree()
  const walking = mode === 'walk'
  const keys = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  })
  const lastFolder = useRef<string | null>(null)
  const front = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3(0, 1, 0))
  const move = useRef(new THREE.Vector3())
  const lastFly = useRef(0)
  const lookAt = useRef(new THREE.Vector3())
  const [steering, setSteering] = useState(true)
  const controlsRef = useRef<PointerLockControlsImpl>(null)
  const capturedLook = useRef(false)
  const lookHeld = useRef(false)
  const flying = useRef<{
    startPos: THREE.Vector3
    endPos: THREE.Vector3
    lookAt: THREE.Vector3
    duration: number
    t: number
  } | null>(null)

  useEffect(() => {
    if (!walking) {
      flying.current = null
      capturedLook.current = false
      setSteering(true)
      return
    }
    if (flyTo && flyTo.nonce !== lastFly.current) {
      lastFly.current = flyTo.nonce
      const end = new THREE.Vector3(landAt[0], CONFIG.eyeHeight, landAt[1])
      lookAt.current.set(flyTo.lookAt[0], flyTo.lookAt[1], flyTo.lookAt[2])
      const dist = camera.position.distanceTo(end)
      flying.current = {
        startPos: camera.position.clone(),
        endPos: end,
        lookAt: lookAt.current.clone(),
        duration: Math.min(1.35, Math.max(0.55, dist * 0.025)),
        t: 0,
      }
      setSteering(false)
      return
    }
    if (flying.current) return
    camera.up.set(0, 1, 0)
    camera.position.set(landAt[0], CONFIG.eyeHeight, landAt[1])
    camera.lookAt(landAt[0], CONFIG.eyeHeight, landAt[1] + 10)
    camera.updateProjectionMatrix()
  }, [camera, flyTo, landAt, walking])

  useEffect(() => {
    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'TEXTAREA' ||
          event.target.tagName === 'INPUT' ||
          event.target.tagName === 'SELECT' ||
          event.target.isContentEditable)
      ) {
        return
      }
      if (event.code === 'KeyW' || event.code === 'ArrowUp') keys.current.forward = down
      if (event.code === 'KeyS' || event.code === 'ArrowDown') keys.current.back = down
      if (event.code === 'KeyA' || event.code === 'ArrowLeft') keys.current.left = down
      if (event.code === 'KeyD' || event.code === 'ArrowRight') keys.current.right = down
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') keys.current.sprint = down
    }

    const down = (event: KeyboardEvent) => onKey(event, true)
    const up = (event: KeyboardEvent) => onKey(event, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    if (!walking || !lockEnabled) {
      controlsRef.current?.unlock()
      document.exitPointerLock()
      return
    }
    if (!steering || capturedLook.current) return
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
  }, [lockEnabled, onLockedChange, steering, walking])

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
      if (walking && flying.current) {
        const flight = flying.current
        flight.t += delta / flight.duration
        const t = Math.min(1, flight.t)
        const ease = t * t * (3 - 2 * t)
        camera.position.lerpVectors(flight.startPos, flight.endPos, ease)
        const dist = flight.startPos.distanceTo(flight.endPos)
        camera.position.y =
          CONFIG.eyeHeight + Math.sin(t * Math.PI) * Math.min(14, 3.5 + dist * 0.1)
        camera.up.set(0, 1, 0)
        camera.lookAt(flight.lookAt)
        if (t >= 1) {
          camera.position.copy(flight.endPos)
          camera.up.set(0, 1, 0)
          camera.lookAt(flight.lookAt)
          flying.current = null
          setSteering(true)
        }
      } else if (walking && locked) {
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
      const nextPath = locationLabel(camera.position.x, camera.position.z, layout)
      if (nextPath !== lastFolder.current) {
        lastFolder.current = nextPath
        onFolderChange(nextPath)
      }
    } catch {
      // Movement must never stop the render loop.
    }
  })

  if (!walking) return null

  return (
    <>
      <PerspectiveCamera
        makeDefault
        fov={70}
        near={0.1}
        far={400}
        position={[landAt[0], CONFIG.eyeHeight, landAt[1]]}
      />
      <PlayerLight />
      <PointerLockControls
        ref={controlsRef}
        makeDefault
        selector=".stage canvas"
        enabled={steering && lockEnabled}
        onLock={() => onLockedChange(true)}
        onUnlock={() => onLockedChange(false)}
      />
    </>
  )
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
