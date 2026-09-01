import { Suspense } from 'react'
import { Html, Text } from '@react-three/drei'
import { DoubleSide } from 'three'
import {
  BLUEPRINT_OVERLAY,
  CHANGE_HIGHLIGHT,
  CONFIG,
  blueprintPalette,
  folderAisleColor,
  folderFloorColor,
  MAP_SELECTION,
  type ChangeKind,
} from '../theme'
import { isBlueprintFolder } from '../layout'
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
  overlay?: boolean
  overlayY?: number
  pickPath?: string
  pickLayer?: string
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
  overlay = false,
  overlayY = BLUEPRINT_OVERLAY.folderY,
  pickPath,
  pickLayer,
}: FolderAreaProps) {
  const added = Boolean(folder.added)
  const gitKind =
    overlay || (highlightKind === 'add' && isBlueprintFolder(folder))
      ? null
      : highlightKind
  const highlight = gitKind ? CHANGE_HIGHLIGHT[gitKind] : null
  const addedOnly = added && !highlight
  const tint = overlay || addedOnly ? blueprintPalette(folder.colorHex) : null
  const outline = highlight
    ? highlight.color
    : overlay || addedOnly
      ? tint?.color ?? '#7ec8e8'
      : null
  const color = highlight
    ? highlight.floor
    : overlay
      ? tint?.wash ?? '#7ec8e8'
      : addedOnly
        ? tint?.color ?? '#38bdf8'
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
    gitKind === 'remove'
      ? `- ${folder.name}`
      : gitKind === 'add' || added
        ? `+ ${folder.name}`
        : folder.name

  const faded = overlay || opacity < 1
  const wash = overlay ? BLUEPRINT_OVERLAY.folderOpacity * opacity : opacity
  const floorMaterial = {
    transparent: faded,
    opacity: overlay ? wash : opacity,
    depthWrite: !faded,
  }

  return (
    <group
      position={[folder.x, overlay ? overlayY : 0, folder.z + folder.depth / 2]}
      userData={
        pickPath
          ? { mapFolderPath: pickPath, mapFolderLayer: pickLayer ?? null }
          : undefined
      }
    >
      {outline && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, overlay ? 0.02 : -0.01, 0]}>
          <planeGeometry args={[folder.width + 0.9, folder.depth + 0.9]} />
          <meshBasicMaterial
            color={outline}
            toneMapped={false}
            transparent={faded}
            opacity={
              overlay ? BLUEPRINT_OVERLAY.folderOutlineOpacity * opacity : floorMaterial.opacity
            }
            depthWrite={!faded}
            side={overlay ? DoubleSide : undefined}
          />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={overlay ? 2 : 0}>
        <planeGeometry args={[folder.width, folder.depth]} />
        <meshBasicMaterial
          color={color}
          transparent={faded}
          opacity={overlay ? wash : opacity}
          depthWrite={!faded}
          toneMapped={overlay ? false : true}
          side={overlay ? DoubleSide : undefined}
        />
      </mesh>
      {selected && mapMode && (
        <MapSelectBorder
          width={folder.width}
          depth={folder.depth}
          y={overlay ? 0.08 : 0.06}
          stroke={MAP_SELECTION.islandPad}
          color={MAP_SELECTION.island}
        />
      )}
      {eyeColors.length > 0 && !naming && !overlay && (
        <MapSelectBorder
          width={folder.width}
          depth={folder.depth}
          y={selected && mapMode ? 0.09 : 0.05}
          stroke={MAP_SELECTION.pointedPad}
          color={pointedColor ?? MAP_SELECTION.pointed}
        />
      )}
      {!overlay && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CONFIG.bridgeWidth, folder.depth]} />
          <meshBasicMaterial color={aisle} {...floorMaterial} />
        </mesh>
      )}
      {!overlay && folder.width > 28 && (
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
