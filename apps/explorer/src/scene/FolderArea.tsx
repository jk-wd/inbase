import { Suspense } from 'react'
import { Html, Text } from '@react-three/drei'
import {
  CHANGE_HIGHLIGHT,
  CONFIG,
  folderAisleColor,
  folderFloorColor,
  MAP_SELECTION,
  type ChangeKind,
} from '../theme'
import type { PlacedFolder } from '../types'
import { MapSelectBorder } from './MapSelectBorder'

type FolderAreaProps = {
  folder: PlacedFolder
  naming?: boolean
  selected?: boolean
  mapMode?: boolean
  highlightKind?: ChangeKind | null
  previewLabels?: boolean
}

export function FolderArea({
  folder,
  naming = false,
  selected = false,
  mapMode = false,
  highlightKind = null,
  previewLabels = false,
}: FolderAreaProps) {
  const added = Boolean(folder.added)
  const highlight = highlightKind ? CHANGE_HIGHLIGHT[highlightKind] : null
  const addedOnly = added && !highlight
  const outline = highlight ? highlight.color : addedOnly ? '#7ec8e8' : null
  const color = highlight
    ? highlight.floor
    : addedOnly
      ? '#16323f'
      : folderFloorColor(folder.path)
  const aisle = highlight
    ? highlight.aisle
    : addedOnly
      ? '#23485a'
      : folderAisleColor(folder.path)
  const label =
    highlightKind === 'remove'
      ? `- ${folder.name}`
      : highlightKind === 'add' || added
        ? `+ ${folder.name}`
        : folder.name

  return (
    <group position={[folder.x, 0, folder.z + folder.depth / 2]}>
      {outline && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[folder.width + 0.9, folder.depth + 0.9]} />
          <meshBasicMaterial
            color={outline}
            toneMapped={false}
          />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[folder.width, folder.depth]} />
        <meshBasicMaterial color={color} />
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
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CONFIG.bridgeWidth, folder.depth]} />
        <meshBasicMaterial color={aisle} />
      </mesh>
      {folder.width > 28 && (
        <mesh
          position={[0, 0.02, folder.depth / 2 - CONFIG.bridgeWidth / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[folder.width, CONFIG.bridgeWidth]} />
          <meshBasicMaterial color={aisle} />
        </mesh>
      )}
      <Suspense fallback={null}>
        {!naming && previewLabels && (
          <Html
            position={[0, 1.35, -folder.depth / 2 + 1.6]}
            center
            occlude={false}
            style={{ pointerEvents: 'none' }}
            zIndexRange={[20, 0]}
          >
            <div className="thumbnail-folder-label">{label}</div>
          </Html>
        )}
        {!naming && !previewLabels && !mapMode && (
          <Text
            position={[0, 0.05, -folder.depth / 2 + 1.6]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.55}
            color={
              highlight ? highlight.color : addedOnly ? '#9ad8ff' : '#8b95a5'
            }
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
