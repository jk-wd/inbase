import { useRef } from 'react'
import { Instances, Instance } from '@react-three/drei'
import { dimColor, fileColor, blueprintPalette } from '../theme'
import type { FileNode, PlacedFile } from '../types'

type DistantFile = {
  file: FileNode
  placed: PlacedFile
  dimmed: boolean
}

export function DistantFileBlocks({
  items,
}: {
  items: DistantFile[]
}) {
  const cap = useRef(2048)
  if (items.length > cap.current) cap.current = items.length
  if (items.length === 0) return null

  return (
    <Instances
      limit={cap.current}
      range={items.length}
      frustumCulled
      raycast={() => {}}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
      {items.map(({ file, placed, dimmed }) => {
        const color = file.userCreated || file.colorHex
          ? blueprintPalette(file.colorHex).block
          : fileColor(file.language)
        return (
          <Instance
            key={file.id}
            position={placed.position}
            scale={placed.size}
            color={dimmed ? dimColor(color, 0.32) : color}
            userData={{ fileId: file.id }}
          />
        )
      })}
    </Instances>
  )
}
