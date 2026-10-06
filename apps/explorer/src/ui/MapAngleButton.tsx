import { useSyncExternalStore } from 'react'
import {
  getMapViewAngle,
  isTopDownAngle,
  requestMapViewReset,
  subscribeMapViewAngle,
} from '../mapViewAngle'

/** Compass that mirrors the map camera angle. Click resets to the straight-down, north-up map. */
export function MapAngleButton() {
  const angle = useSyncExternalStore(subscribeMapViewAngle, getMapViewAngle)
  const topDown = isTopDownAngle(angle)
  const tiltDeg = Math.round((angle.tilt * 180) / Math.PI)
  const label = topDown
    ? 'Shift + drag to tilt and rotate the map'
    : `Tilted ${tiltDeg}°, click to reset to top-down`

  return (
    <button
      className="hud-button hud-icon-button hud-map-angle"
      type="button"
      aria-label={label}
      data-tilted={topDown ? undefined : 'true'}
      onClick={() => {
        if (!topDown) requestMapViewReset()
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        style={{
          transform: `rotateX(${angle.tilt}rad) rotate(${angle.heading}rad)`,
        }}
      >
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="#ffffff" strokeWidth="1.4" />
        <path d="M12 3.6 15 12H9Z" fill="#ffffff" />
        <path
          d="M12 20.4 9 12h6Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="hud-tooltip">{label}</span>
    </button>
  )
}
