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
import { NameInput } from '../ui/NameInput'
import { EyeIcon } from '../ui/EyeIcon'

type FolderAreaProps = {
  folder: PlacedFolder
  naming?: boolean
  selected?: boolean
  mapMode?: boolean
  highlightKind?: ChangeKind | null
  previewLabels?: boolean
  labelVisible?: boolean
  pointed?: boolean
  onCommitName?: (name: string) => void
  onCancelName?: () => void
}

export function FolderArea({
  folder,
  naming = false,
  selected = false,
  mapMode = false,
  highlightKind = null,
  previewLabels = false,
  labelVisible = true,
  pointed = false,
  onCommitName,
  onCancelName,
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
      {pointed && !naming && (
        <Html
          position={[0, mapMode ? 1.15 : 1.45, -folder.depth / 2 + 2.2]}
          center
          occlude={false}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[40, 0]}
        >
          <div
            className="blueprint-eye"
            data-map={mapMode ? 'true' : 'false'}
            role="img"
            aria-label="Keep in mind"
          >
            <EyeIcon size={mapMode ? 18 : 22} title="Keep in mind" />
          </div>
        </Html>
      )}
      {naming && mapMode && onCommitName && onCancelName && (
        <Html
          position={[0, 1.35, -folder.depth / 2 + 1.35]}
          center
          occlude={false}
          wrapperClass="block-name-overlay"
          zIndexRange={[120, 0]}
        >
          <NameInput
            placeholder="Folder name"
            onCommit={onCommitName}
            onCancel={onCancelName}
          />
        </Html>
      )}
      <Suspense fallback={null}>
        {!naming && previewLabels && labelVisible && (
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
        {!naming && !previewLabels && !mapMode && labelVisible && (
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
