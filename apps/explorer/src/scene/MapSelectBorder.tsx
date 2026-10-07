import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP_SELECTION } from '../theme'

type MapSelectBorderProps = {
  width: number
  depth: number
  y?: number
  stroke?: number
  /** Distance from the footprint edge to the ring's outer edge; the ring always sits inside the footprint. */
  inset?: number
  color?: string
  opacity?: number
  renderOrder?: number
  depthTest?: boolean
  userData?: Record<string, unknown>
}

export function MapSelectBorder({
  width,
  depth,
  y = 0.04,
  stroke = MAP_SELECTION.blockPad,
  inset = 0,
  color = MAP_SELECTION.color,
  opacity = 1,
  renderOrder = 10,
  depthTest = true,
  userData,
}: MapSelectBorderProps) {
  const geometry = useMemo(() => {
    const outerW = Math.max(width - inset * 2, 0.02)
    const outerD = Math.max(depth - inset * 2, 0.02)
    const innerW = Math.max(outerW - stroke * 2, 0.01)
    const innerD = Math.max(outerD - stroke * 2, 0.01)
    const shape = new THREE.Shape()
    shape.moveTo(-outerW / 2, -outerD / 2)
    shape.lineTo(outerW / 2, -outerD / 2)
    shape.lineTo(outerW / 2, outerD / 2)
    shape.lineTo(-outerW / 2, outerD / 2)
    shape.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-innerW / 2, -innerD / 2)
    hole.lineTo(-innerW / 2, innerD / 2)
    hole.lineTo(innerW / 2, innerD / 2)
    hole.lineTo(innerW / 2, -innerD / 2)
    hole.closePath()
    shape.holes.push(hole)
    return new THREE.ShapeGeometry(shape)
  }, [depth, inset, stroke, width])

  return (
    <mesh
      geometry={geometry}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      userData={userData}
    >
      <meshBasicMaterial
        color={color}
        toneMapped={false}
        transparent
        opacity={opacity}
        depthTest={depthTest}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}
