import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  label: string
  active?: boolean
}

/** Botón cuadrado de icono con estado activo opcional; `label` sirve de tooltip y a11y. */
export function IconButton({
  icon,
  label,
  active = false,
  className = '',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-accent/40 bg-accent/15 text-accent'
          : 'border-transparent text-muted hover:bg-border/60 hover:text-text'
      } ${className}`}
      {...rest}
    >
      {icon}
    </button>
  )
}
