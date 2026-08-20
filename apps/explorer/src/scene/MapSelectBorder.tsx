import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP_SELECTION } from '../theme'

type MapSelectBorderProps = {
  width: number
  depth: number
  y?: number
  stroke?: number
  userData?: Record<string, unknown>
}

export function MapSelectBorder({
  width,
  depth,
  y = 0.04,
  stroke = MAP_SELECTION.blockPad,
  userData,
}: MapSelectBorderProps) {
  const geometry = useMemo(() => {
    const innerW = width
    const innerD = depth
    const outerW = width + stroke * 2
    const outerD = depth + stroke * 2
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
  }, [depth, stroke, width])

  return (
    <mesh
      geometry={geometry}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
      userData={userData}
    >
      <meshBasicMaterial
        color={MAP_SELECTION.color}
        toneMapped={false}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}
