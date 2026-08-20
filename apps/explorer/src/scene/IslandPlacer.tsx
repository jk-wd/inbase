import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { folderAt } from '../layout'
import type { WorldLayout } from '../types'

type IslandPlacerProps = {
  enabled: boolean
  layout: WorldLayout
  onPlace: (parent: string) => void
}

function typingInField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  )
}

export function IslandPlacer({ enabled, layout, onPlace }: IslandPlacerProps) {
  const { camera } = useThree()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!enabled || event.repeat || event.code !== 'KeyB') return
      if (typingInField(event.target)) return
      const island = folderAt(camera.position.x, camera.position.z, layout)
      if (!island) return
      event.preventDefault()
      onPlace(island.path)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, enabled, layout, onPlace])

  return null
}
