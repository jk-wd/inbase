import { memo, Suspense, useRef, useState } from 'react'
import { Billboard, Edges, Html, Text } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { BLUEPRINT_FILE_COLOR, CHANGE_HIGHLIGHT, CONFIG, EXPLAIN_FOCUS, dimColor, fileColor, fileEmphasisScale, FILE_SELECTION, MAP_SELECTION, type ChangeKind } from '../theme'
import { BlueprintEyes, BlueprintNotes, mapMarkDistanceFactor, mapMarkIconWorld, mapMarkOffsetX } from '../ui/EyeIcon'
import { MapSelectBorder } from './MapSelectBorder'
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

const CHANGE_BORDER_STROKE = 0.46
/** Letter fills this fraction of the file, then shrinks with the same zoom cap as map badges. */
const CHANGE_MARK_FILL = 0.78

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

const CHANGE_MARK_LETTER: Record<ChangeKind, string> = {
  add: 'A',
  edit: 'U',
  remove: 'D',
}

function changeMarkKind(changeKind: ChangeKind | null, added: boolean): ChangeKind | null {
  if (changeKind) return changeKind
  if (added) return 'add'
  return null
}

function MapChangeMark({
  kind,
  width,
  depth,
  height,
  opacity = 1,
  color = '#000000',
}: {
  kind: ChangeKind
  width: number
  depth: number
  height: number
  opacity?: number
  color?: string
}) {
  const zoom = useMapZoom()
  const fileSize = Math.min(width, depth)
  const size = mapMarkIconWorld(fileSize, zoom) * CHANGE_MARK_FILL
  const zoomedIn = size > 0 && size < fileSize * 0.55
  const pad = size * 0.22
  const position: [number, number, number] = zoomedIn
    ? [width / 2 - pad, height / 2 + 0.12, -depth / 2 + pad]
    : [0, height / 2 + 0.12, 0]
  return (
    <Suspense fallback={null}>
      <Text
        position={position}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={size}
        color={color}
        fillOpacity={opacity}
        anchorX={zoomedIn ? 'right' : 'center'}
        anchorY={zoomedIn ? 'top' : 'middle'}
        outlineWidth={0}
        renderOrder={10}
        onSync={(mesh) => {
          mesh.material.toneMapped = false
        }}
      >
        {CHANGE_MARK_LETTER[kind]}
      </Text>
    </Suspense>
  )
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
  const emphasis =
    !mapMode && (onBlueprint || Boolean(file.userCreated))
      ? 1
      : fileEmphasisScale(
          overlay,
          changeKind,
          added || Boolean(file.userCreated),
        )
  const width = placed.size[0] * emphasis
  const height = placed.size[1]
  const depth = placed.size[2] * emphasis
  const color = onBlueprint ? BLUEPRINT_FILE_COLOR : fileColor(file.language)
  const muted = dimColor(color, EXPLAIN_FOCUS.dimColorAmount)
  const label = fileLabel(file.name, change, isAdded)
  const markKind = changeMarkKind(change, isAdded)
  const changeColor = !onBlueprint && change ? CHANGE_HIGHLIGHT[change].color : null
  const borderColor = changeColor
    ? dimmed
      ? dimColor(changeColor, EXPLAIN_FOCUS.dimColorAmount)
      : changeColor
    : null
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
        : BLUEPRINT_FILE_COLOR
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
        <boxGeometry args={[1, 1, 1]} />
        {mapMode ? (
          <meshBasicMaterial
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
                    : BLUEPRINT_FILE_COLOR
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
          stroke={CHANGE_BORDER_STROKE}
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
          color={MAP_SELECTION.explain}
          userData={{ fileId: file.id }}
        />
      )}
      {mapMode && !naming && markKind && (
        <MapChangeMark
          kind={markKind}
          width={width}
          depth={depth}
          height={height}
          opacity={opacity}
          color={onBlueprint && selected ? '#ffffff' : '#000000'}
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
