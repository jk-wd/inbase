import { Suspense } from 'react'
import { Billboard, Edges, Html, Text } from '@react-three/drei'
import { CHANGE_HIGHLIGHT, CONFIG, dimColor, fileColor, type ChangeKind } from '../theme'
import { NameInput } from '../ui/NameInput'
import { MapSelectBorder } from './MapSelectBorder'
import type { FileNode } from '../types'
import type { PlacedFile } from '../types'

const BAR = 0.22
const SIDE_LABEL_PAD = 0.05
const SIDE_LABEL_MIN_HEIGHT = CONFIG.eyeHeight * 2.5
const SIDE_LABELS: { rotationY: number; axis: 'x' | 'z'; sign: 1 | -1 }[] = [
  { rotationY: 0, axis: 'z', sign: 1 },
  { rotationY: Math.PI, axis: 'z', sign: -1 },
  { rotationY: Math.PI / 2, axis: 'x', sign: 1 },
  { rotationY: -Math.PI / 2, axis: 'x', sign: -1 },
]

type FileBlockProps = {
  file: FileNode
  placed: PlacedFile
  selected: boolean
  related: boolean
  planned: boolean
  changeKind?: ChangeKind | null
  added?: boolean
  aimed?: boolean
  dimmed: boolean
  naming?: boolean
  mapMode?: boolean
  onCommitName?: (name: string) => void
  onCancelName?: () => void
}

function PlannedFrame({
  width,
  height,
  depth,
  color,
}: {
  width: number
  height: number
  depth: number
  color: string
}) {
  const ox = width / 2 + BAR / 2
  const oy = height / 2 + BAR / 2
  const oz = depth / 2 + BAR / 2
  const bars: [number, number, number, number, number, number][] = [
    [ox, 0, oz, BAR, height + BAR * 2, BAR],
    [-ox, 0, oz, BAR, height + BAR * 2, BAR],
    [ox, 0, -oz, BAR, height + BAR * 2, BAR],
    [-ox, 0, -oz, BAR, height + BAR * 2, BAR],
    [0, oy, oz, width + BAR * 2, BAR, BAR],
    [0, oy, -oz, width + BAR * 2, BAR, BAR],
    [ox, oy, 0, BAR, BAR, depth],
    [-ox, oy, 0, BAR, BAR, depth],
    [0, -oy, oz, width + BAR * 2, BAR, BAR],
    [0, -oy, -oz, width + BAR * 2, BAR, BAR],
    [ox, -oy, 0, BAR, BAR, depth],
    [-ox, -oy, 0, BAR, BAR, depth],
  ]

  return (
    <group>
      {bars.map(([x, y, z, w, h, d], index) => (
        <mesh key={index} position={[x, y, z]}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function fileLabel(name: string, changeKind: ChangeKind | null, added: boolean) {
  if (changeKind === 'remove') return `- ${name}`
  if (changeKind === 'add' || added) return `+ ${name}`
  return name
}

export function FileBlock({
  file,
  placed,
  selected,
  related,
  planned,
  changeKind = null,
  added = false,
  aimed = false,
  dimmed,
  naming = false,
  mapMode = false,
  onCommitName,
  onCancelName,
}: FileBlockProps) {
  const [width, height, depth] = placed.size
  const highlight = changeKind && mapMode ? CHANGE_HIGHLIGHT[changeKind] : null
  const color = added || file.userCreated ? '#7ec8e8' : fileColor(file.language)
  const muted = dimColor(color, 0.32)
  const walkSelected = selected && !mapMode
  const mapSelected = selected && mapMode
  const label = fileLabel(file.name, changeKind, added || Boolean(file.userCreated))
  const labelColor = aimed
    ? '#9ad8ff'
    : highlight
      ? highlight.color
      : dimmed
        ? '#b4bcc8'
        : '#e7ebf2'
  const meshColor = aimed
    ? '#9ad8ff'
    : highlight
      ? highlight.color
      : walkSelected
        ? '#5d9ec4'
        : related
          ? '#4e7f72'
          : dimmed
            ? muted
            : color

  return (
    <group position={placed.position}>
      {highlight && !mapSelected && (
        <mesh
          position={[0, height / 2 + 0.04, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          userData={{ fileId: file.id }}
        >
          <planeGeometry args={[width + 0.7, depth + 0.7]} />
          <meshBasicMaterial color={highlight.color} toneMapped={false} />
        </mesh>
      )}
      <mesh userData={{ fileId: file.id }}>
        <boxGeometry args={[width, height, depth]} />
        <meshLambertMaterial
          color={meshColor}
          emissive={
            aimed
              ? '#3a6a80'
              : highlight
                ? highlight.emissive
                : walkSelected
                  ? '#2a4a5c'
                  : related
                    ? '#1f4a44'
                    : added || file.userCreated
                      ? '#2a5064'
                      : dimmed
                        ? muted
                        : color
          }
          emissiveIntensity={
            aimed
              ? 0.45
              : highlight
                ? 0.95
                : walkSelected
                  ? 0.28
                  : related
                    ? 0.18
                    : added || file.userCreated
                      ? 0.22
                      : dimmed
                        ? 0.08
                        : 0.12
          }
        />
        {walkSelected && (
          <Edges
            color="#000000"
            dashed
            dashSize={0.18}
            gapSize={0.1}
            lineWidth={2.5}
            toneMapped={false}
            scale={1.002}
          />
        )}
      </mesh>
      {mapSelected && (
        <MapSelectBorder
          width={width}
          depth={depth}
          y={height / 2 + 0.05}
          userData={{ fileId: file.id }}
        />
      )}
      {highlight && !mapSelected && (
        <PlannedFrame
          width={width}
          height={height}
          depth={depth}
          color={highlight.color}
        />
      )}
      {naming && onCommitName && onCancelName && (
        <Html
          position={[0, height / 2 + 0.42, 0]}
          center
          occlude={false}
          wrapperClass="block-name-overlay"
          zIndexRange={[100, 0]}
        >
          <NameInput
            placeholder="File name"
            onCommit={onCommitName}
            onCancel={onCancelName}
          />
        </Html>
      )}
      <Suspense fallback={null}>
        {!naming && (
          <Billboard position={[0, height / 2 + (planned || highlight ? 0.55 : 0.38), 0]}>
            <Text
              fontSize={0.28}
              color={labelColor}
              anchorX="center"
              anchorY="bottom"
              maxWidth={3.4}
            >
              {label}
            </Text>
          </Billboard>
        )}
        {height >= SIDE_LABEL_MIN_HEIGHT &&
          SIDE_LABELS.map((side) => {
            const face = side.axis === 'x' ? width : depth
            const x =
              side.axis === 'x' ? side.sign * (width / 2 + SIDE_LABEL_PAD) : 0
            const z =
              side.axis === 'z' ? side.sign * (depth / 2 + SIDE_LABEL_PAD) : 0
            return (
              <Text
                key={`${side.axis}:${side.sign}`}
                position={[x, -height / 2 + 0.22, z]}
                rotation={[0, side.rotationY, 0]}
                fontSize={0.22}
                color={labelColor}
                anchorX="center"
                anchorY="middle"
                maxWidth={face - 0.2}
                overflowWrap="break-word"
                outlineWidth={0.012}
                outlineColor="#11151c"
                depthOffset={-1}
              >
                {label}
              </Text>
            )
          })}
      </Suspense>
    </group>
  )
}
