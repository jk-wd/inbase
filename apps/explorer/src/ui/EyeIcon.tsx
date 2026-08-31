export const EYE_ICON_PATH =
  'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z'

export function eyeIconMarkup(size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${EYE_ICON_PATH}"/><circle cx="12" cy="12" r="3"/></svg>`
}

export function EyeIcon({
  size = 18,
  title,
}: {
  size?: number
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={EYE_ICON_PATH} />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function BlueprintEyes({
  colors,
  mapMode,
  size = 18,
}: {
  colors: string[]
  mapMode?: boolean
  size?: number
}) {
  if (colors.length === 0) return null
  return (
    <div
      className={colors.length > 1 ? 'blueprint-eye-row' : undefined}
      role="img"
      aria-label="Keep in mind"
    >
      {colors.map((hex, index) => (
        <div
          className="blueprint-eye"
          data-map={mapMode ? 'true' : 'false'}
          key={`${hex}-${index}`}
          style={{ color: hex }}
        >
          <EyeIcon size={size} title={index === 0 ? 'Keep in mind' : undefined} />
        </div>
      ))}
    </div>
  )
}
