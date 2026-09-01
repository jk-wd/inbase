import { Suspense } from 'react'
import { Text } from '@react-three/drei'
import { folderAt } from '../layout'
import { CONFIG, folderAisleColor } from '../theme'
import type { PlacedBridge, PlacedFolder } from '../types'

const WALK_Y = 0.02
const LAND_COLOR = 'hsl(210, 6%, 40%)'
const SPAN_COLOR = '#232e3a'
const CORNER_SIZE = CONFIG.bridgeWidth

const POST_W = 0.3
const POST_D = 0.38
const POST_H = 3.45
const LINTEL_H = 0.34
const CAP_H = 0.2
const CAP_OVERHANG = 0.42
const SIGN_H = 0.72
const SIGN_D = 0.08
const GATE_COLOR = '#4a5564'
const CAP_COLOR = '#5a6574'
const SIGN_COLOR = '#323a46'

type BridgeProps = {
  bridge: PlacedBridge
  folders?: Record<string, PlacedFolder>
}

function landColorAt(
  x: number,
  z: number,
  folders: Record<string, PlacedFolder> | undefined,
) {
  if (!folders) return LAND_COLOR
  const folder = folderAt(x, z, { folders })
  if (!folder) return LAND_COLOR
  if (folder.added) return '#23485a'
  return folderAisleColor(folder.path)
}

type Segment = {
  key: string
  x: number
  z: number
  width: number
  depth: number
}

type WalkPiece = Segment & { color: string }

export type BridgeDeckPiece = WalkPiece

export const BRIDGE_DECK_Y = WALK_Y

function segmentsFromPoints(points: [number, number][]): Segment[] {
  const segments: Segment[] = []

  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1]
    const [x1, z1] = points[i]
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
    const length = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0)
    if (length < 0.01) continue

    segments.push({
      key: `seg-${i}`,
      x: (x0 + x1) / 2,
      z: (z0 + z1) / 2,
      width: alongX ? length : CONFIG.bridgeWidth,
      depth: alongX ? CONFIG.bridgeWidth : length,
    })
  }

  return segments
}

function cornersFromPoints(points: [number, number][]) {
  const corners: { x: number; z: number }[] = []
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const point = points[i]
    const next = points[i + 1]
    const incomingX = Math.abs(point[0] - prev[0]) > Math.abs(point[1] - prev[1])
    const outgoingX = Math.abs(next[0] - point[0]) > Math.abs(next[1] - point[1])
    if (incomingX !== outgoingX) {
      corners.push({ x: point[0], z: point[1] })
    }
  }
  return corners
}

function splitOverLand(segment: Segment): WalkPiece[] {
  const overlap = CONFIG.bridgeOverlap
  const alongX = segment.width >= segment.depth
  const length = alongX ? segment.width : segment.depth
  const spanLength = Math.max(0, length - overlap * 2)

  if (spanLength < 0.01) {
    return [{ ...segment, color: LAND_COLOR }]
  }

  if (alongX) {
    const left = segment.x - length / 2
    return [
      {
        key: `${segment.key}-land-a`,
        x: left + overlap / 2,
        z: segment.z,
        width: overlap,
        depth: segment.depth,
        color: LAND_COLOR,
      },
      {
        key: `${segment.key}-span`,
        x: segment.x,
        z: segment.z,
        width: spanLength,
        depth: segment.depth,
        color: SPAN_COLOR,
      },
      {
        key: `${segment.key}-land-b`,
        x: left + length - overlap / 2,
        z: segment.z,
        width: overlap,
        depth: segment.depth,
        color: LAND_COLOR,
      },
    ]
  }

  const start = segment.z - length / 2
  return [
    {
      key: `${segment.key}-land-a`,
      x: segment.x,
      z: start + overlap / 2,
      width: segment.width,
      depth: overlap,
      color: LAND_COLOR,
    },
    {
      key: `${segment.key}-span`,
      x: segment.x,
      z: segment.z,
      width: segment.width,
      depth: spanLength,
      color: SPAN_COLOR,
    },
    {
      key: `${segment.key}-land-b`,
      x: segment.x,
      z: start + length - overlap / 2,
      width: segment.width,
      depth: overlap,
      color: LAND_COLOR,
    },
  ]
}

function Walk({
  x,
  z,
  width,
  depth,
  color,
}: {
  x: number
  z: number
  width: number
  depth: number
  color: string
}) {
  return (
    <mesh position={[x, WALK_Y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

function segmentDir(from: [number, number], to: [number, number]): [number, number] {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.001) return [0, 1]
  return [dx / length, dz / length]
}

function signFontSize(label: string, lintelW: number) {
  return Math.min(0.42, (lintelW - 0.55) / Math.max(label.length * 0.62, 3))
}

function GateSign({
  z,
  rotY,
  signY,
  lintelW,
  label,
}: {
  z: number
  rotY: number
  signY: number
  lintelW: number
  label: string
}) {
  return (
    <group>
      <mesh position={[0, signY, z]}>
        <boxGeometry args={[lintelW - 0.18, SIGN_H, SIGN_D]} />
        <meshLambertMaterial color={SIGN_COLOR} />
      </mesh>
      <Suspense fallback={null}>
        <Text
          position={[0, signY, z + Math.sign(z) * (SIGN_D / 2 + 0.01)]}
          rotation={[0, rotY, 0]}
          fontSize={signFontSize(label, lintelW)}
          color="#e7ebf2"
          anchorX="center"
          anchorY="middle"
          maxWidth={lintelW - 0.4}
          overflowWrap="break-word"
          outlineWidth={0.02}
          outlineColor="#07080b"
        >
          {label}
        </Text>
      </Suspense>
    </group>
  )
}

function Gate({
  x,
  z,
  faceX,
  faceZ,
  label,
  backLabel,
}: {
  x: number
  z: number
  faceX: number
  faceZ: number
  label: string
  backLabel: string
}) {
  const rotationY = Math.atan2(faceX, faceZ)
  const postX = CONFIG.bridgeWidth / 2 + POST_W / 2
  const lintelW = postX * 2 + POST_W
  const capW = lintelW + CAP_OVERHANG * 2
  const lintelY = POST_H + LINTEL_H / 2
  const capY = POST_H + LINTEL_H + CAP_H / 2
  const signY = POST_H + LINTEL_H / 2
  const signZ = POST_D / 2 + SIGN_D / 2 + 0.01

  return (
    <group position={[x, 0, z]} rotation={[0, rotationY, 0]}>
      <mesh position={[-postX, POST_H / 2, 0]}>
        <boxGeometry args={[POST_W, POST_H, POST_D]} />
        <meshLambertMaterial color={GATE_COLOR} />
      </mesh>
      <mesh position={[postX, POST_H / 2, 0]}>
        <boxGeometry args={[POST_W, POST_H, POST_D]} />
        <meshLambertMaterial color={GATE_COLOR} />
      </mesh>
      <mesh position={[0, lintelY, 0]}>
        <boxGeometry args={[lintelW, LINTEL_H, POST_D]} />
        <meshLambertMaterial color={GATE_COLOR} />
      </mesh>
      <mesh position={[0, capY, 0]}>
        <boxGeometry args={[capW, CAP_H, POST_D + 0.08]} />
        <meshLambertMaterial color={CAP_COLOR} />
      </mesh>
      <GateSign z={signZ} rotY={0} signY={signY} lintelW={lintelW} label={label} />
      {backLabel ? (
        <GateSign
          z={-signZ}
          rotY={Math.PI}
          signY={signY}
          lintelW={lintelW}
          label={backLabel}
        />
      ) : null}
    </group>
  )
}

export function bridgeDeckPieces(
  bridge: PlacedBridge,
  folders?: Record<string, PlacedFolder>,
): BridgeDeckPiece[] {
  const pieces: BridgeDeckPiece[] = segmentsFromPoints(bridge.points).flatMap(
    (segment) =>
      splitOverLand(segment).map((piece) => ({
        ...piece,
        color:
          piece.color === LAND_COLOR
            ? landColorAt(piece.x, piece.z, folders)
            : piece.color,
      })),
  )
  for (const corner of cornersFromPoints(bridge.points)) {
    pieces.push({
      key: `corner-${corner.x}-${corner.z}`,
      x: corner.x,
      z: corner.z,
      width: CORNER_SIZE,
      depth: CORNER_SIZE,
      color: SPAN_COLOR,
    })
  }
  return pieces
}

export function Bridge({ bridge, folders }: BridgeProps) {
  const deck = bridgeDeckPieces(bridge, folders)
  const start = bridge.points[0]
  const end = bridge.points[bridge.points.length - 1]
  const second = bridge.points[1]
  const beforeEnd = bridge.points[bridge.points.length - 2]
  const startDir = start && second ? segmentDir(start, second) : null
  const endDir = beforeEnd && end ? segmentDir(beforeEnd, end) : null

  return (
    <group>
      {deck.map((piece) => (
        <Walk
          key={piece.key}
          x={piece.x}
          z={piece.z}
          width={piece.width}
          depth={piece.depth}
          color={piece.color}
        />
      ))}

      {start && startDir && (
        <Gate
          x={start[0]}
          z={start[1]}
          faceX={-startDir[0]}
          faceZ={-startDir[1]}
          label={bridge.label}
          backLabel={bridge.fromLabel}
        />
      )}
      {end && endDir && (
        <Gate
          x={end[0]}
          z={end[1]}
          faceX={endDir[0]}
          faceZ={endDir[1]}
          label={bridge.fromLabel}
          backLabel={bridge.label}
        />
      )}
    </group>
  )
}
