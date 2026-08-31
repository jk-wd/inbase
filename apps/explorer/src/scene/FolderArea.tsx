import { Suspense } from 'react'
import { Html, Text } from '@react-three/drei'
import {
  CHANGE_HIGHLIGHT,
  CONFIG,
  blueprintPalette,
  folderAisleColor,
  folderFloorColor,
  MAP_SELECTION,
  type ChangeKind,
} from '../theme'
import type { PlacedFolder } from '../types'
import { MapSelectBorder } from './MapSelectBorder'
import { BlueprintEyes } from '../ui/EyeIcon'

type FolderAreaProps = {
  folder: PlacedFolder
  naming?: boolean
  selected?: boolean
  mapMode?: boolean
  highlightKind?: ChangeKind | null
  labelVisible?: boolean
  pointed?: boolean
  pointedColors?: string[]
  opacity?: number
}

export function FolderArea({
  folder,
  naming = false,
  selected = false,
  mapMode = false,
  highlightKind = null,
  labelVisible = true,
  pointed = false,
  pointedColors,
  opacity = 1,
}: FolderAreaProps) {
  const added = Boolean(folder.added)
  const highlight = highlightKind ? CHANGE_HIGHLIGHT[highlightKind] : null
  const addedOnly = added && !highlight
  const tint = addedOnly ? blueprintPalette(folder.colorHex) : null
  const outline = highlight ? highlight.color : addedOnly ? tint?.color ?? '#7ec8e8' : null
  const color = highlight
    ? highlight.floor
    : addedOnly
      ? tint?.floor ?? '#16323f'
      : folderFloorColor(folder.path)
  const aisle = highlight
    ? highlight.aisle
    : addedOnly
      ? tint?.aisle ?? '#23485a'
      : folderAisleColor(folder.path)
  const eyeColors =
    pointedColors && pointedColors.length > 0
      ? pointedColors
      : pointed
        ? [MAP_SELECTION.pointed]
        : []
  const pointedColor = eyeColors[eyeColors.length - 1]
  const label =
    highlightKind === 'remove'
      ? `- ${folder.name}`
      : highlightKind === 'add' || added
        ? `+ ${folder.name}`
        : folder.name

  const faded = opacity < 1
  const floorMaterial = {
    transparent: faded,
    opacity,
    depthWrite: !faded,
  }

  return (
    <group position={[folder.x, 0, folder.z + folder.depth / 2]}>
      {outline && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[folder.width + 0.9, folder.depth + 0.9]} />
          <meshBasicMaterial
            color={outline}
            toneMapped={false}
            {...floorMaterial}
          />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[folder.width, folder.depth]} />
        <meshBasicMaterial
          color={color}
          transparent={faded}
          opacity={opacity}
          depthWrite={!faded}
        />
      </mesh>
      {selected && mapMode && (
        <MapSelectBorder
          width={folder.width}
          depth={folder.depth}
          y={0.06}
          stroke={MAP_SELECTION.islandPad}
          color={MAP_SELECTION.island}
        />
      )}
      {eyeColors.length > 0 && !naming && (
        <MapSelectBorder
          width={folder.width}
          depth={folder.depth}
          y={selected && mapMode ? 0.09 : 0.05}
          stroke={MAP_SELECTION.pointedPad}
          color={pointedColor ?? MAP_SELECTION.pointed}
        />
      )}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CONFIG.bridgeWidth, folder.depth]} />
        <meshBasicMaterial color={aisle} {...floorMaterial} />
      </mesh>
      {folder.width > 28 && (
        <mesh
          position={[0, 0.02, folder.depth / 2 - CONFIG.bridgeWidth / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[folder.width, CONFIG.bridgeWidth]} />
          <meshBasicMaterial color={aisle} {...floorMaterial} />
        </mesh>
      )}
      {eyeColors.length > 0 && !naming && !mapMode && (
        <Html
          position={[1.45, 1.75, -folder.depth / 2 + 1.6]}
          center
          occlude={false}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[40, 0]}
        >
          <BlueprintEyes colors={eyeColors} size={20} />
        </Html>
      )}
      <Suspense fallback={null}>
        {!naming && !mapMode && labelVisible && (
          <Text
            position={[0, 0.05, -folder.depth / 2 + 1.6]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.55}
            color={
              pointedColor
                ? pointedColor
                : highlight
                  ? highlight.color
                  : addedOnly
                    ? tint?.label ?? '#9ad8ff'
                    : '#8b95a5'
            }
            fillOpacity={opacity}
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
        )}
      </Suspense>
    </group>
  )
}
