import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { fileDisplayName, relationPairLabel } from '../layout'
import type { AimedRelation, FileNode, PlacedFile, PatchImport, WorldLayout } from '../types'

const SELECTED_COLOR = '#ffffff'
const SELECTED_AIM = '#ffffff'
const IMPORTED_BY_COLOR = '#b57bff'
const IMPORTED_BY_AIM = '#ecd9ff'
const PATCH_COLOR = '#f0d24a'
const PATCH_AIM = '#fff4c2'
const UP = new THREE.Vector3(0, 1, 0)
const PROJECT = new THREE.Vector3()

type RelationLinesProps = {
  selectedId: string | null
  aimedRelation: AimedRelation | null
  onAimRelation?: (aim: AimedRelation | null) => void
  files: FileNode[]
  layout: WorldLayout
  extras?: Record<string, PlacedFile>
  plannedIds?: string[]
  plannedEdges?: PatchImport[]
  extraEdges?: PatchImport[]
  fromAbove?: boolean
  importedBy?: boolean
  focusIds?: string[]
  drawPlanned?: boolean
  drawExisting?: boolean
}

type ArrowHead = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  radius: number
  height: number
}

type OverlayPoint = { x: number; y: number; z: number }

type OverlayArrow = OverlayPoint & { tx: number; ty: number; tz: number }

type LineMesh = {
  id: string
  from: string
  to: string
  planned: boolean
  geometry: THREE.TubeGeometry
  arrows: ArrowHead[]
  points: OverlayPoint[]
  overlayArrows: OverlayArrow[]
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
  const arrows = arrowHeads(curve, radius, fromAbove, towardImported)
  const direction = new THREE.Vector3()
  return {
    id: `${from.id}->${toId}`,
    from: from.id,
    to: toId,
    planned,
    geometry: new THREE.TubeGeometry(curve, 28, radius, 6, false),
    arrows,
    points: curve.getPoints(28).map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
    })),
    overlayArrows: arrows.map((arrow) => {
      direction.set(0, 1, 0).applyQuaternion(arrow.quaternion)
      return {
        x: arrow.position.x,
        y: arrow.position.y,
        z: arrow.position.z,
        tx: direction.x,
        ty: direction.y,
        tz: direction.z,
      }
    }),
  }
}

function lineColor(planned: boolean, aimed: boolean, importedBy: boolean) {
  if (planned) return aimed ? PATCH_AIM : PATCH_COLOR
  if (importedBy) return aimed ? IMPORTED_BY_AIM : IMPORTED_BY_COLOR
  return aimed ? SELECTED_AIM : SELECTED_COLOR
}

function projectToScreen(
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  PROJECT.set(x, y, z).project(camera)
  return {
    x: (PROJECT.x * 0.5 + 0.5) * width,
    y: (-PROJECT.y * 0.5 + 0.5) * height,
  }
}

function closestOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  if (len < 1e-8) {
    return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) }
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
  const x = ax + t * dx
  const y = ay + t * dy
  return { x, y, dist: Math.hypot(px - x, py - y) }
}

const HOVER_HIT_PX = 10

function MapRelationOverlay({
  meshes,
  aimedRelation,
  importedBy,
  files,
  onAimRelation,
}: {
  meshes: LineMesh[]
  aimedRelation: AimedRelation | null
  importedBy: boolean
  files: FileNode[]
  onAimRelation?: (aim: AimedRelation | null) => void
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const labelRef = useRef<HTMLDivElement | null>(null)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const lastAimRef = useRef('')
  const onAimRef = useRef(onAimRelation)
  onAimRef.current = onAimRelation
  const invalidate = useThree((state) => state.invalidate)

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'map-relation-layer')
    svg.setAttribute('aria-hidden', 'true')
    parent.appendChild(svg)
    svgRef.current = svg
    const label = document.createElement('div')
    label.className = 'map-file-label map-relation-hover'
    label.style.position = 'absolute'
    label.style.top = '0'
    label.style.left = '0'
    const name = document.createElement('span')
    name.className = 'map-file-name'
    label.appendChild(name)
    parent.appendChild(label)
    labelRef.current = label
    return () => {
      svg.remove()
      label.remove()
      svgRef.current = null
      labelRef.current = null
      if (lastAimRef.current) {
        lastAimRef.current = ''
        onAimRef.current?.(null)
      }
    }
  }, [gl])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.replaceChildren()
    for (const mesh of meshes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.dataset.id = mesh.id
      const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      glow.setAttribute('fill', 'none')
      glow.setAttribute('stroke-linecap', 'round')
      glow.setAttribute('stroke-linejoin', 'round')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      group.appendChild(glow)
      group.appendChild(path)
      for (let i = 0; i < mesh.overlayArrows.length; i += 1) {
        group.appendChild(
          document.createElementNS('http://www.w3.org/2000/svg', 'polygon'),
        )
      }
      svg.appendChild(group)
    }
  }, [meshes])

  useEffect(() => {
    const element = gl.domElement
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        mouseRef.current = null
        invalidate()
        return
      }
      const rect = element.getBoundingClientRect()
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        mouseRef.current = null
        invalidate()
        return
      }
      mouseRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * size.width,
        y: ((event.clientY - rect.top) / rect.height) * size.height,
      }
      invalidate()
    }
    const onLeave = () => {
      mouseRef.current = null
      invalidate()
    }
    window.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', onLeave)
    }
  }, [gl, invalidate, size.height, size.width])

  useFrame(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)
    svg.setAttribute('width', String(size.width))
    svg.setAttribute('height', String(size.height))
    const nodes = svg.children
    const mouse = mouseRef.current
    let hover: LineMesh | null = null
    let hoverDist = HOVER_HIT_PX
    let hoverX = 0
    let hoverY = 0
    for (let i = 0; i < meshes.length; i += 1) {
      const group = nodes[i] as SVGGElement | undefined
      const mesh = meshes[i]
      if (!group || !mesh) continue
      const aimed =
        aimedRelation?.from === mesh.from && aimedRelation?.to === mesh.to
      const color = lineColor(mesh.planned, aimed, importedBy)
      let d = ''
      let prevX = 0
      let prevY = 0
      for (let p = 0; p < mesh.points.length; p += 1) {
        const point = mesh.points[p]
        const screen = projectToScreen(
          point.x,
          point.y,
          point.z,
          camera,
          size.width,
          size.height,
        )
        d += `${p === 0 ? 'M' : 'L'}${screen.x.toFixed(1)},${screen.y.toFixed(1)}`
        if (mouse && p > 0) {
          const hit = closestOnSegment(
            mouse.x,
            mouse.y,
            prevX,
            prevY,
            screen.x,
            screen.y,
          )
          if (hit.dist < hoverDist) {
            hoverDist = hit.dist
            hover = mesh
            hoverX = hit.x
            hoverY = hit.y
          }
        }
        prevX = screen.x
        prevY = screen.y
      }
      const glow = group.children[0] as SVGPathElement
      const stroke = group.children[1] as SVGPathElement
      glow.setAttribute('d', d)
      glow.setAttribute('stroke', color)
      glow.setAttribute('stroke-width', aimed ? '8' : '6')
      glow.setAttribute('stroke-opacity', aimed ? '0.38' : '0.22')
      stroke.setAttribute('d', d)
      stroke.setAttribute('stroke', color)
      stroke.setAttribute('stroke-width', aimed ? '3.2' : '2.4')
      stroke.removeAttribute('stroke-opacity')
      for (let a = 0; a < mesh.overlayArrows.length; a += 1) {
        const arrow = group.children[a + 2] as SVGPolygonElement | undefined
        const head = mesh.overlayArrows[a]
        if (!arrow || !head) continue
        const from = projectToScreen(
          head.x,
          head.y,
          head.z,
          camera,
          size.width,
          size.height,
        )
        const to = projectToScreen(
          head.x + head.tx,
          head.y + head.ty,
          head.z + head.tz,
          camera,
          size.width,
          size.height,
        )
        const angle = Math.atan2(to.y - from.y, to.x - from.x)
        const sizePx = aimed ? 9 : 7
        const tipX = from.x + Math.cos(angle) * sizePx
        const tipY = from.y + Math.sin(angle) * sizePx
        const backX = from.x - Math.cos(angle) * sizePx * 0.55
        const backY = from.y - Math.sin(angle) * sizePx * 0.55
        const px = -Math.sin(angle) * sizePx * 0.58
        const py = Math.cos(angle) * sizePx * 0.58
        arrow.setAttribute(
          'points',
          `${tipX},${tipY} ${backX + px},${backY + py} ${backX - px},${backY - py}`,
        )
        arrow.setAttribute('fill', color)
        arrow.removeAttribute('fill-opacity')
      }
    }
    const nextAim = hover
      ? { from: hover.from, to: hover.to, flyTo: hover.to }
      : null
    const nextKey = nextAim ? `${nextAim.from}->${nextAim.to}` : ''
    if (nextKey !== lastAimRef.current) {
      lastAimRef.current = nextKey
      onAimRef.current?.(nextAim)
    }
    const label = labelRef.current
    if (label) {
      if (hover) {
        const text = relationPairLabel(
          fileDisplayName(hover.from, files),
          fileDisplayName(hover.to, files),
        )
        const name = label.firstElementChild
        if (name && name.textContent !== text) name.textContent = text
        label.style.transform = `translate3d(${Math.round(hoverX)}px, ${Math.round(hoverY)}px, 0) translate(-50%, calc(-100% - 8px))`
        if (label.style.visibility !== 'visible') label.style.visibility = 'visible'
      } else if (label.style.visibility !== 'hidden') {
        label.style.visibility = 'hidden'
      }
    }
  })

  return null
}

export function RelationLines({
  selectedId,
  aimedRelation,
  onAimRelation,
  files,
  layout,
  extras = {},
  plannedIds = [],
  plannedEdges = [],
  extraEdges = [],
  fromAbove = false,
  importedBy = false,
  focusIds = [],
  drawPlanned = true,
  drawExisting = true,
}: RelationLinesProps) {
  const meshes = useMemo(() => {
    const placed = { ...layout.files, ...extras }
    const selectedRadius = fromAbove ? 0.2 : 0.07
    const plannedRadius = fromAbove ? 0.26 : 0.1
    const lines: LineMesh[] = []
    const drawn = new Set<string>()
    const plannedKeys = new Set(
      plannedEdges.map((edge) => `${edge.from}->${edge.to}`),
    )
    const relationIds =
      focusIds.length > 0 ? focusIds : selectedId ? [selectedId] : plannedIds
    const relationSet = new Set(relationIds)
    const amongPlanned =
      focusIds.length === 0 && !selectedId && relationSet.size > 0

    const addLine = (
      fromId: string,
      toId: string,
      planned: boolean,
      radius: number,
    ) => {
      const key = `${fromId}->${toId}`
      if (drawn.has(key)) return
      const from = placed[fromId]
      const to = placed[toId]
      if (!from || !to) return
      drawn.add(key)
      const isPlanned = planned || plannedKeys.has(key)
      lines.push(
        edgeMesh(
          from,
          to,
          toId,
          isPlanned,
          isPlanned ? plannedRadius : radius,
          fromAbove,
          false,
        ),
      )
    }

    if (drawPlanned) {
      for (const edge of plannedEdges) {
        addLine(edge.from, edge.to, true, plannedRadius)
      }
    } else if (relationIds.length > 0) {
      for (const edge of plannedEdges) {
        const include = importedBy
          ? relationSet.has(edge.to)
          : relationSet.has(edge.from)
        if (!include) continue
        addLine(edge.from, edge.to, true, plannedRadius)
      }
    }

    for (const edge of extraEdges) {
      addLine(edge.from, edge.to, false, selectedRadius)
    }

    if (drawExisting && relationIds.length > 0) {
      if (importedBy) {
        for (const file of files) {
          for (const id of relationIds) {
            if (file.id === id || !file.imports.includes(id)) continue
            if (amongPlanned && !relationSet.has(file.id)) continue
            addLine(file.id, id, false, selectedRadius)
          }
        }
      } else {
        const byId = new Map(files.map((file) => [file.id, file]))
        for (const id of relationIds) {
          const file = byId.get(id)
          if (!file) continue
          for (const importId of file.imports) {
            if (amongPlanned && !relationSet.has(importId)) continue
            addLine(file.id, importId, false, selectedRadius)
          }
        }
      }
    }

    return [...lines.filter((line) => !line.planned), ...lines.filter((line) => line.planned)]
  }, [
    drawExisting,
    drawPlanned,
    extras,
    extraEdges,
    files,
    focusIds,
    fromAbove,
    importedBy,
    layout.files,
    plannedEdges,
    plannedIds,
    selectedId,
  ])

  if (meshes.length === 0) return null

  return (
    <group>
      {fromAbove && (
        <MapRelationOverlay
          meshes={meshes}
          aimedRelation={aimedRelation}
          importedBy={importedBy}
          files={files}
          onAimRelation={onAimRelation}
        />
      )}
      {meshes.map((mesh) => {
        const aimed =
          aimedRelation?.from === mesh.from && aimedRelation?.to === mesh.to
        const color = lineColor(mesh.planned, aimed, importedBy)
        const glow = aimed ? 2.4 : mesh.planned ? 1.7 : 1.4
        const relation = { relationFrom: mesh.from, relationTo: mesh.to }
        return (
          <group key={mesh.id}>
            <mesh
              geometry={mesh.geometry}
              userData={relation}
              renderOrder={mesh.planned ? 101 : 100}
            >
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={glow}
                roughness={0.3}
                depthTest={false}
                depthWrite={false}
                colorWrite={!fromAbove}
              />
            </mesh>
            {mesh.arrows.map((arrow, index) => (
              <mesh
                key={`${mesh.id}-arrow-${index}`}
                position={arrow.position}
                quaternion={arrow.quaternion}
                userData={relation}
                renderOrder={mesh.planned ? 101 : 100}
              >
                <coneGeometry args={[arrow.radius, arrow.height, 10]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={glow}
                  roughness={0.3}
                  depthTest={false}
                  depthWrite={false}
                  colorWrite={!fromAbove}
                />
              </mesh>
            ))}
          </group>
        )
      })}
    </group>
  )
}
