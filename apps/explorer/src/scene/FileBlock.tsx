import { Suspense } from 'react'
import { Billboard, Edges, Html, Text } from '@react-three/drei'
import { CHANGE_HIGHLIGHT, CONFIG, dimColor, fileColor, FILE_SELECTION, MAP_SELECTION, type ChangeKind } from '../theme'
import { NameInput } from '../ui/NameInput'
import { MapSelectBorder } from './MapSelectBorder'
import type { FileNode } from '../types'
import type { PlacedFile } from '../types'

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
  highlightMapChange?: boolean
  previewLabels?: boolean
  onCommitName?: (name: string) => void
  onCancelName?: () => void
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
  highlightMapChange = mapMode,
  previewLabels = false,
  onCommitName,
  onCancelName,
}: FileBlockProps) {
  const [width, height, depth] = placed.size
  const highlight =
    changeKind && highlightMapChange && !selected
      ? CHANGE_HIGHLIGHT[changeKind]
      : null
  const color = added || file.userCreated ? '#7ec8e8' : fileColor(file.language)
  const muted = dimColor(color, 0.32)
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
      : selected
        ? FILE_SELECTION.color
        : related
          ? '#4e7f72'
          : dimmed
            ? muted
            : color

  const showLabels = !naming && !mapMode

  return (
    <group position={placed.position}>
      <mesh userData={{ fileId: file.id }} scale={[width, height, depth]}>
        <boxGeometry args={[1, 1, 1]} />
        {mapMode ? (
          <meshBasicMaterial color={meshColor} toneMapped={false} />
        ) : (
          <meshLambertMaterial
            color={meshColor}
            emissive={
              aimed
                ? '#3a6a80'
                : highlight
                  ? highlight.emissive
                  : selected
                    ? FILE_SELECTION.emissive
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
                  : selected
                    ? 0.55
                    : related
                      ? 0.18
                      : added || file.userCreated
                        ? 0.22
                        : dimmed
                          ? 0.08
                          : 0.12
            }
          />
        )}
        {selected && !mapMode && (
          <Edges
            color="#000000"
            dashed
            dashSize={0.18}
            gapSize={0.1}
            lineWidth={2.5}
            toneMapped={false}
          />
        )}
      </mesh>
      {selected && mapMode && (
        <MapSelectBorder
          width={width}
          depth={depth}
          y={height / 2 + 0.03}
          stroke={MAP_SELECTION.blockPad}
          userData={{ fileId: file.id }}
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
      {showLabels && (
        <Suspense fallback={null}>
          {previewLabels ? (
            <Html
              position={[0, height / 2 + 0.55, 0]}
              center
              occlude={false}
              style={{ pointerEvents: 'none' }}
              zIndexRange={[20, 0]}
            >
              <div className="thumbnail-block-label">{label}</div>
            </Html>
          ) : (
            <>
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
            </>
          )}
        </Suspense>
      )}
    </group>
  )
}
