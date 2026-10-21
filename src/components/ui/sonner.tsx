"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

/**
 * As cores vivas do sonner (`richColors`) usam, no tema claro, texto em 45% de
 * luminosidade sobre fundo quase branco: a razão fica entre 3,3:1 e 4,4:1,
 * abaixo do 4,5:1 que a WCAG AA exige para texto pequeno — a auditoria axe
 * aponta `color-contrast` com impacto serious no título do aviso.
 *
 * Escurecemos só o texto do tema claro, mantendo a identidade de cor por tipo.
 * Razões medidas sobre o fundo de cada tipo: sucesso 5,98:1 · informação 6,6:1
 * · atenção 5,4:1 · erro 6,1:1. O tema escuro já usa texto claro sobre fundo
 * escuro e passa sem ajuste, por isso não é sobrescrito.
 */
const TEXTO_CLARO_ACESSIVEL = {
  "--success-text": "hsl(140, 100%, 22%)",
  "--info-text": "hsl(210, 92%, 35%)",
  "--warning-text": "hsl(31, 92%, 32%)",
  "--error-text": "hsl(360, 100%, 38%)",
} as const

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system", resolvedTheme } = useTheme()
  const escuro = (resolvedTheme ?? theme) === "dark"

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          ...(escuro ? {} : TEXTO_CLARO_ACESSIVEL),
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
