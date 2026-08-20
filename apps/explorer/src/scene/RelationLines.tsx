import { useMemo } from 'react'
import * as THREE from 'three'
import type { AimedRelation, FileNode, PlacedFile, PatchImport, WorldLayout } from '../types'

const SELECTED_COLOR = '#6ad2ff'
const SELECTED_AIM = '#e7f7ff'
const IMPORTED_BY_COLOR = '#b57bff'
const IMPORTED_BY_AIM = '#ecd9ff'
const PATCH_COLOR = '#f0d24a'
const PATCH_AIM = '#fff4c2'
const UP = new THREE.Vector3(0, 1, 0)

type RelationLinesProps = {
  selectedId: string | null
  aimedRelation: AimedRelation | null
  files: FileNode[]
  layout: WorldLayout
  extras?: Record<string, PlacedFile>
  plannedEdges?: PatchImport[]
  fromAbove?: boolean
  importedBy?: boolean
}

type ArrowHead = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  radius: number
  height: number
}

type LineMesh = {
  id: string
  from: string
  to: string
  planned: boolean
  geometry: THREE.TubeGeometry
  arrows: ArrowHead[]
}

function fileTop(file: PlacedFile) {
  return new THREE.Vector3(
    file.position[0],
    file.position[1] + file.size[1] / 2,
    file.position[2],
  )
}

function arcCurve(start: THREE.Vector3, end: THREE.Vector3) {
  const mid = start.clone().lerp(end, 0.5)
  const dx = end.x - start.x
  const dz = end.z - start.z
  const length = Math.hypot(dx, dz) || 1
  const bow = Math.min(5.5, length * 0.14)
  mid.x += (-dz / length) * bow
  mid.z += (dx / length) * bow
  mid.y = Math.max(start.y, end.y) + 2.4 + length * 0.06
  return new THREE.QuadraticBezierCurve3(start, mid, end)
}

function arrowAt(
  curve: THREE.QuadraticBezierCurve3,
  t: number,
  radius: number,
  height: number,
  towardImported: boolean,
): ArrowHead {
  const tangent = curve.getTangentAt(t)
  if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0)
  else tangent.normalize()
  if (!towardImported) tangent.negate()
  return {
    position: curve.getPointAt(t),
    quaternion: new THREE.Quaternion().setFromUnitVectors(UP, tangent),
    radius,
    height,
  }
}

function arrowHeads(
  curve: THREE.QuadraticBezierCurve3,
  radius: number,
  fromAbove: boolean,
  towardImported: boolean,
): ArrowHead[] {
  const height = Math.max(radius * 6.5, fromAbove ? 0.9 : 0.42)
  const coneRadius = Math.max(radius * 2.8, fromAbove ? 0.32 : 0.15)
  return [
    arrowAt(curve, 0.18, coneRadius, height, towardImported),
    arrowAt(curve, 0.82, coneRadius, height, towardImported),
  ]
}

function edgeMesh(
  from: PlacedFile,
  to: PlacedFile,
  toId: string,
  planned: boolean,
  radius: number,
  fromAbove: boolean,
  towardImported: boolean,
): LineMesh {
  const curve = arcCurve(fileTop(from), fileTop(to))
  return {
    id: `${from.id}->${toId}`,
    from: from.id,
    to: toId,
    planned,
    geometry: new THREE.TubeGeometry(curve, 28, radius, 6, false),
    arrows: arrowHeads(curve, radius, fromAbove, towardImported),
  }
}

export function RelationLines({
  selectedId,
  aimedRelation,
  files,
  layout,
  extras = {},
  plannedEdges = [],
  fromAbove = false,
  importedBy = false,
}: RelationLinesProps) {
  const meshes = useMemo(() => {
    const placed = { ...layout.files, ...extras }
    const selectedRadius = fromAbove ? 0.2 : 0.07
    const plannedRadius = fromAbove ? 0.26 : 0.1
    const lines: LineMesh[] = []
    const plannedKeys = new Set<string>()

    for (const edge of plannedEdges) {
      const from = placed[edge.from]
      const to = placed[edge.to]
      if (!from || !to) continue
      const key = `${edge.from}->${edge.to}`
      if (plannedKeys.has(key)) continue
      plannedKeys.add(key)
      lines.push(edgeMesh(from, to, edge.to, true, plannedRadius, fromAbove, false))
    }

    if (selectedId) {
      const selected = placed[selectedId]
      if (selected) {
        if (importedBy) {
          for (const file of files) {
            if (file.id === selectedId || !file.imports.includes(selectedId)) continue
            if (plannedKeys.has(`${file.id}->${selectedId}`)) continue
            const importer = placed[file.id]
            if (!importer) continue
            lines.push(
              edgeMesh(importer, selected, selectedId, false, selectedRadius, fromAbove, false),
            )
          }
        } else {
          const file = files.find((item) => item.id === selectedId)
          if (file) {
            for (const importId of file.imports) {
              if (plannedKeys.has(`${file.id}->${importId}`)) continue
              const target = placed[importId]
              if (!target) continue
              lines.push(
                edgeMesh(selected, target, importId, false, selectedRadius, fromAbove, false),
              )
            }
          }
        }
      }
    }

    return lines
  }, [extras, files, fromAbove, importedBy, layout.files, plannedEdges, selectedId])

  if (meshes.length === 0) return null

  return (
    <group>
      {meshes.map((mesh) => {
        const aimed =
          aimedRelation?.from === mesh.from && aimedRelation?.to === mesh.to
        const color = mesh.planned
          ? aimed
            ? PATCH_AIM
            : PATCH_COLOR
          : importedBy
            ? aimed
              ? IMPORTED_BY_AIM
              : IMPORTED_BY_COLOR
            : aimed
              ? SELECTED_AIM
              : SELECTED_COLOR
        const glow = aimed ? 2.4 : mesh.planned ? 1.7 : 1.4
        const relation = { relationFrom: mesh.from, relationTo: mesh.to }
        return (
          <group key={mesh.id}>
            <mesh geometry={mesh.geometry} userData={relation}>
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={glow}
                roughness={0.3}
              />
            </mesh>
            {mesh.arrows.map((arrow, index) => (
              <mesh
                key={`${mesh.id}-arrow-${index}`}
                position={arrow.position}
                quaternion={arrow.quaternion}
                userData={relation}
              >
                <coneGeometry args={[arrow.radius, arrow.height, 10]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={glow}
                  roughness={0.3}
                />
              </mesh>
            ))}
          </group>
        )
      })}
    </group>
  )
}
