import { memo, Suspense, useRef, useState } from 'react'
import { Billboard, Edges, Html, Text } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { blueprintPalette, CHANGE_HIGHLIGHT, CONFIG, EXPLAIN_FOCUS, dimColor, fileColor, FILE_SELECTION, MAP_SELECTION, type ChangeKind } from '../theme'
import { BlueprintEyes, BlueprintNotes, mapMarkDistanceFactor, mapMarkOffsetX } from '../ui/EyeIcon'
import { MapSelectBorder } from './MapSelectBorder'
import { MAP_BLOCK_GEOMETRY } from './mapBlockGeometry'
import type { FileNode } from '../types'
import type { PlacedFile } from '../types'

function useMapZoom() {
  const camera = useThree((state) => state.camera)
  const zoomOf = () => ('zoom' in camera ? Number(camera.zoom) || 1 : 1)
  const [zoom, setZoom] = useState(zoomOf)
  const zoomRef = useRef(zoom)
  useFrame(() => {
    const next = zoomOf()
    if (Math.abs(next - zoomRef.current) < 1e-4) return
    zoomRef.current = next
    setZoom(next)
  })
  return zoom
}

const SIDE_LABEL_PAD = 0.05
const SIDE_LABEL_FOOT_PAD = 0.08
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
  focused?: boolean
  naming?: boolean
  mapMode?: boolean
  labelVisible?: boolean
  pointed?: boolean
  pointedColors?: string[]
  noted?: boolean
  notedColors?: string[]
  onOpenNote?: (fileId: string, color?: string) => void
  opacity?: number
  overlay?: boolean
  overlayFilled?: boolean
  blueprint?: boolean
}

function fileLabel(name: string, changeKind: ChangeKind | null, added: boolean) {
  if (changeKind === 'remove') return `- ${name}`
  if (changeKind === 'add' || added) return `+ ${name}`
  return name
}

export function FileMarks({
  mapMode,
  width,
  depth,
  height,
  noteColors,
  eyeColors,
  fileName,
  onOpen,
  opacity = 1,
}: {
  mapMode: boolean
  width: number
  depth: number
  height: number
  noteColors: string[]
  eyeColors: string[]
  fileName: string
  onOpen?: (color: string) => void
  opacity?: number
}) {
  const zoom = useMapZoom()
  const count = noteColors.length + eyeColors.length
  return (
    <Html
      position={
        mapMode
          ? [mapMarkOffsetX(width, depth, count, zoom), height / 2 + 0.04, 0]
          : [width * 0.38, height / 2 + 0.18, 0]
      }
      center
      distanceFactor={mapMode ? mapMarkDistanceFactor(width, depth, zoom) : undefined}
      occlude={false}
      style={{ pointerEvents: 'none', opacity }}
      zIndexRange={[88, 72]}
    >
      <div className="blueprint-mark-row">
        <BlueprintNotes
          colors={noteColors}
          mapMode={mapMode}
          label={`Open note for ${fileName}`}
          onOpen={onOpen}
        />
        <BlueprintEyes colors={eyeColors} mapMode={mapMode} />
      </div>
    </Html>
  )
}

export const FileBlock = memo(function FileBlock({
  file,
  placed,
  selected,
  related,
  planned,
  changeKind = null,
  added = false,
  aimed = false,
  dimmed,
  focused = false,
  naming = false,
  mapMode = false,
  labelVisible = true,
  pointed = false,
  pointedColors,
  noted = false,
  notedColors,
  onOpenNote,
  opacity = 1,
  overlay = false,
  overlayFilled = false,
  blueprint = false,
}: FileBlockProps) {
  const onBlueprint = overlay || blueprint || Boolean(file.colorHex)
  const isAdded = overlay ? !overlayFilled : added || Boolean(file.userCreated)
  const change =
    changeKind ?? (onBlueprint && isAdded && !overlayFilled ? 'add' : null)
  const [width, height, depth] = placed.size
  const blueprintFile = blueprintPalette(file.colorHex).file
  const color = onBlueprint ? blueprintFile : fileColor()
  const muted = dimColor(color, EXPLAIN_FOCUS.dimColorAmount)
  const label = fileLabel(file.name, change, isAdded)
  const changeColor = !onBlueprint && change ? CHANGE_HIGHLIGHT[change].color : null
  const borderColor = changeColor
    ? dimmed
      ? dimColor(changeColor, EXPLAIN_FOCUS.dimColorAmount)
      : changeColor
    : null
  const selectionInset = borderColor ? MAP_SELECTION.blockChange : 0
  const eyeColors =
    pointedColors && pointedColors.length > 0
      ? pointedColors
      : pointed
        ? ['#f4f7fb']
        : []
  const noteColors =
    notedColors && notedColors.length > 0
      ? notedColors
      : noted
        ? ['#f4f7fb']
        : []
  const labelColor = aimed
    ? '#9ad8ff'
    : borderColor
      ? borderColor
      : dimmed
        ? '#b4bcc8'
        : '#e7ebf2'
  const selectionColor = onBlueprint
    ? FILE_SELECTION.blueprintColor
    : FILE_SELECTION.color
  const meshColor = onBlueprint
    ? selected
      ? selectionColor
      : dimmed
        ? muted
        : blueprintFile
    : aimed
      ? '#9ad8ff'
      : selected
        ? selectionColor
        : related
          ? '#4e7f72'
          : dimmed
            ? muted
            : color

  const showLabels = !naming && !mapMode && labelVisible
  const fade = overlay || opacity < 1

  return (
    <group position={placed.position} visible={!overlay || opacity > 0}>
      <mesh
        userData={{ fileId: file.id }}
        scale={[width, height, depth]}
        renderOrder={overlay ? 3 : 0}
      >
        {mapMode ? (
          <primitive object={MAP_BLOCK_GEOMETRY} attach="geometry" />
        ) : (
          <boxGeometry args={[1, 1, 1]} />
        )}
        {mapMode ? (
          <meshBasicMaterial
            vertexColors
            color={meshColor}
            toneMapped={false}
            transparent={fade}
            opacity={opacity}
            depthWrite={!fade}
          />
        ) : (
          <meshLambertMaterial
            color={meshColor}
            transparent={fade}
            opacity={opacity}
            depthWrite={!fade}
            emissive={
              onBlueprint
                ? selected
                  ? FILE_SELECTION.blueprintEmissive
                  : dimmed
                    ? muted
                    : blueprintFile
                : aimed
                  ? '#3a6a80'
                  : selected
                    ? FILE_SELECTION.emissive
                    : related
                      ? '#1f4a44'
                      : isAdded
                        ? '#2a5064'
                        : dimmed
                          ? muted
                          : color
            }
            emissiveIntensity={
              onBlueprint
                ? dimmed
                  ? 0.08
                  : 0.35
                : aimed
                  ? 0.45
                  : selected
                    ? 0.55
                    : related
                      ? 0.18
                      : isAdded
                        ? 0.22
                        : dimmed
                          ? 0.08
                          : 0.12
            }
          />
        )}
        {borderColor && !mapMode && (
          <Edges color={borderColor} lineWidth={2.5} toneMapped={false} />
        )}
        {selected && !mapMode && (
          <Edges
            color={selectionColor}
            dashed
            dashSize={0.18}
            gapSize={0.1}
            lineWidth={2.5}
            toneMapped={false}
          />
        )}
      </mesh>
      {borderColor && mapMode && (
        <MapSelectBorder
          width={width}
          depth={depth}
          y={height / 2 + 0.02}
          stroke={MAP_SELECTION.blockChange}
          color={borderColor}
          opacity={opacity}
          renderOrder={overlay ? 4 : 2}
          userData={{ fileId: file.id }}
        />
      )}
      {selected && mapMode && (
        <MapSelectBorder
          width={width}
          depth={depth}
          y={height / 2 + 0.03}
          stroke={MAP_SELECTION.blockPad}
          inset={selectionInset}
          color={selectionColor}
          userData={{ fileId: file.id }}
        />
      )}
      {focused && mapMode && (
        <MapSelectBorder
          width={width}
          depth={depth}
          y={height / 2 + (selected ? 0.06 : 0.03)}
          stroke={MAP_SELECTION.explainPad}
          inset={selectionInset + (selected ? MAP_SELECTION.blockPad : 0)}
          color={MAP_SELECTION.explain}
          userData={{ fileId: file.id }}
        />
      )}
      {(eyeColors.length > 0 || noteColors.length > 0) && !naming && (
        <FileMarks
          mapMode={mapMode}
          width={width}
          depth={depth}
          height={height}
          noteColors={noteColors}
          eyeColors={eyeColors}
          fileName={file.name}
          opacity={opacity}
          onOpen={
            mapMode && onOpenNote && !file.id.startsWith('draft:')
              ? (color) => onOpenNote(file.id, color)
              : undefined
          }
        />
      )}
      {showLabels && (
        <Suspense fallback={null}>
          <Billboard position={[0, height / 2 + (planned || borderColor ? 0.55 : 0.38), 0]}>
            <Text
              fontSize={0.28}
              color={labelColor}
              fillOpacity={opacity}
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
                  position={[x, -height / 2 + SIDE_LABEL_FOOT_PAD, z]}
                  rotation={[0, side.rotationY, 0]}
                  fontSize={0.22}
                  color={labelColor}
                  fillOpacity={opacity}
                  anchorX="center"
                  anchorY="bottom"
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
      )}
    </group>
  )
})
