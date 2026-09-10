import type { ReactNode } from 'react'

export const EYE_ICON_PATH =
  'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z'

export function eyeIconMarkup(size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${EYE_ICON_PATH}"/><circle cx="12" cy="12" r="3"/></svg>`
}

function StrokeIcon({
  size,
  title,
  children,
}: {
  size: number
  title?: string
  children: ReactNode
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
      {children}
    </svg>
  )
}

export function EyeIcon({
  size = 18,
  title,
}: {
  size?: number
  title?: string
}) {
  return (
    <StrokeIcon size={size} title={title}>
      <path d={EYE_ICON_PATH} />
      <circle cx="12" cy="12" r="3" />
    </StrokeIcon>
  )
}

export function FileIcon({
  size = 16,
  title = 'File',
}: {
  size?: number
  title?: string
}) {
  return (
    <StrokeIcon size={size} title={title}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </StrokeIcon>
  )
}

export function FolderIcon({
  size = 16,
  title = 'Folder',
}: {
  size?: number
  title?: string
}) {
  return (
    <StrokeIcon size={size} title={title}>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </StrokeIcon>
  )
}

export function ColorPageIcon({
  direction,
  size = 14,
}: {
  direction: 'prev' | 'next'
  size?: number
}) {
  return (
    <StrokeIcon size={size}>
      {direction === 'next' ? (
        <path d="m9 6 6 6-6 6" />
      ) : (
        <path d="m15 18-6-6 6-6" />
      )}
    </StrokeIcon>
  )
}

export function PersonIcon({
  size = 22,
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
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="5.2" r="3.3" fill="currentColor" />
      <path
        fill="currentColor"
        d="M9.1 9.2c0-.7.6-1.3 1.3-1.3h3.2c.7 0 1.3.6 1.3 1.3v4.4c0 .4-.3.7-.7.7h-.5v7.1c0 .5-.4.9-.9.9h-.5c-.5 0-.9-.4-.9-.9v-7.1h-.5c-.4 0-.7-.3-.7-.7z"
      />
    </svg>
  )
}

export function PanelToggleIcon({
  side,
  hidden,
  size = 18,
}: {
  side: 'left' | 'right'
  hidden: boolean
  size?: number
}) {
  const open = hidden
  return (
    <StrokeIcon size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {side === 'left' ? (
        <>
          <path d="M9 3v18" />
          {open ? (
            <path d="m14 9 3 3-3 3" />
          ) : (
            <path d="m16 15-3-3 3-3" />
          )}
        </>
      ) : (
        <>
          <path d="M15 3v18" />
          {open ? (
            <path d="m10 15-3-3 3-3" />
          ) : (
            <path d="m8 9 3 3-3 3" />
          )}
        </>
      )}
    </StrokeIcon>
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
