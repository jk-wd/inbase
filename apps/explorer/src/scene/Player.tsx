import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, PointerLockControls } from '@react-three/drei'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { CONFIG } from '../theme'
import type { FlyTo, ViewMode, WorldLayout } from '../types'

const lookDir = new THREE.Vector3()
const flyPos = new THREE.Vector3()
const flyLook = new THREE.Vector3()

function smootherstep(t: number) {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function quadBezier(
  out: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  t: number,
) {
  const u = 1 - t
  out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  )
  return out
}

type PlayerProps = {
  layout: WorldLayout
  mode: ViewMode
  landAt: [number, number]
  locked: boolean
  lockEnabled?: boolean
  onLockedChange: (locked: boolean) => void
  onWalkPosition: (x: number, z: number) => void
  flyTo: FlyTo | null
}

export function Player({
  mode,
  landAt,
  locked,
  lockEnabled = true,
  onLockedChange,
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
  const front = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3(0, 1, 0))
  const move = useRef(new THREE.Vector3())
  const lastFly = useRef(0)
  const [steering, setSteering] = useState(true)
  const controlsRef = useRef<PointerLockControlsImpl>(null)
  const capturedLook = useRef(false)
  const lookHeld = useRef(false)
  const poseReady = useRef(false)
  const groundedPose = useRef({
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
  })
  const flying = useRef<{
    startPos: THREE.Vector3
    midPos: THREE.Vector3
    endPos: THREE.Vector3
    startLook: THREE.Vector3
    endLook: THREE.Vector3
    duration: number
    t: number
  } | null>(null)

  useLayoutEffect(() => {
    if (!walking) {
      flying.current = null
      capturedLook.current = false
      poseReady.current = false
      setSteering(true)
      return
    }
    if (flyTo && flyTo.nonce !== lastFly.current) {
      lastFly.current = flyTo.nonce
      const endPos = new THREE.Vector3(landAt[0], CONFIG.eyeHeight, landAt[1])
      const endLook = new THREE.Vector3(flyTo.lookAt[0], flyTo.lookAt[1], flyTo.lookAt[2])
      const startPos = flying.current
        ? camera.position.clone()
        : poseReady.current
          ? groundedPose.current.pos.clone()
          : new THREE.Vector3(flyTo.from[0], CONFIG.eyeHeight, flyTo.from[1])
      const startLook = new THREE.Vector3()
      if (flying.current || poseReady.current) {
        camera.getWorldDirection(lookDir)
        startLook.copy(startPos).addScaledVector(lookDir, 16)
      } else {
        startLook.copy(startPos).lerp(endLook, 0.4)
      }

      const dist = startPos.distanceTo(endPos)
      if (dist < 0.2) {
        placeCamera(camera, endPos, endLook)
        return
      }

      const lift = Math.min(26, 6 + dist * 0.22)
      flying.current = {
        startPos,
        midPos: new THREE.Vector3(
          (startPos.x + endPos.x) * 0.5,
          CONFIG.eyeHeight + lift,
          (startPos.z + endPos.z) * 0.5,
        ),
        endPos,
        startLook,
        endLook,
        duration: Math.min(2.6, Math.max(0.8, 0.55 + dist * 0.04)),
        t: 0,
      }
      placeCamera(camera, startPos, startLook)
      setSteering(false)
      return
    }
    if (flying.current) return
    placeCamera(
      camera,
      new THREE.Vector3(landAt[0], CONFIG.eyeHeight, landAt[1]),
      new THREE.Vector3(landAt[0], CONFIG.eyeHeight, landAt[1] + 10),
    )
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
        flight.t += Math.min(delta, 0.05) / flight.duration
        const t = Math.min(1, flight.t)
        const ease = smootherstep(t)
        quadBezier(flyPos, flight.startPos, flight.midPos, flight.endPos, ease)
        flyLook.lerpVectors(flight.startLook, flight.endLook, ease)
        camera.position.copy(flyPos)
        camera.up.set(0, 1, 0)
        camera.lookAt(flyLook)
        camera.rotation.order = 'YXZ'
        if (t >= 1) {
          placeCamera(camera, flight.endPos, flight.endLook)
          flying.current = null
          poseReady.current = true
          groundedPose.current.pos.copy(flight.endPos)
          groundedPose.current.look.copy(flight.endLook)
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
      if (!flying.current) {
        poseReady.current = true
        groundedPose.current.pos.copy(camera.position)
        camera.getWorldDirection(lookDir)
        groundedPose.current.look.copy(camera.position).addScaledVector(lookDir, 16)
      }
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
        enabled={steering && lockEnabled}
        onLock={() => {
          if (!lockEnabled) {
            controlsRef.current?.unlock()
            document.exitPointerLock()
            onLockedChange(false)
            return
          }
          onLockedChange(true)
        }}
        onUnlock={() => onLockedChange(false)}
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
