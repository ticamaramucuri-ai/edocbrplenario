"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

/**
 * As cores vivas do sonner (`richColors`) usam, no tema claro, texto em 45% de
 * luminosidade sobre fundo quase branco: a razão fica entre 3,3:1 e 4,4:1,
 * abaixo do 4,5:1 que a WCAG AA exige para texto pequeno — a auditoria axe
 * aponta `color-contrast` com impacto serious no título do aviso.
 *
 * O texto escurecido vive em `globals.css`, sob as mesmas condições de tema que
 * o resto da folha, e **não** em `style` inline: inline o valor venceria também
 * no tema escuro, e `resolvedTheme` é `undefined` até o next-themes montar, de
 * modo que um aviso disparado na hidratação sairia com texto escuro sobre fundo
 * escuro. Razões medidas sobre o fundo de cada tipo: sucesso 5,98:1 ·
 * informação 6,6:1 · atenção 5,4:1 · erro 6,1:1.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
