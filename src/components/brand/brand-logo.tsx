import Image from 'next/image'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  inverse?: boolean
  compact?: boolean
  className?: string
}

/** Identidade do produto. A Câmara usa seu brasão em componente separado. */
export function BrandLogo({ inverse = false, compact = false, className }: BrandLogoProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} aria-label="edocBR Plenário">
      <Image
        src={inverse ? '/brand/edocbr-logo-white.svg' : '/brand/edocbr-logo-dark.svg'}
        alt="e-docBR"
        width={268}
        height={68}
        className={cn('h-auto shrink-0 object-contain', compact ? 'w-[106px]' : 'w-[134px]')}
        priority
      />
      <span className={cn('border-l pl-2 text-[10px] font-extrabold tracking-[0.12em]', inverse ? 'border-white/35 text-white' : 'border-[#062f63]/25 text-[#031f43]')}>
        PLENÁRIO
      </span>
    </div>
  )
}

export function TenantCrest({ logoUrl, name, className }: { logoUrl: string | null; name: string; className?: string }) {
  if (!logoUrl) return null
  return <Image src={logoUrl} alt={`Brasão da ${name}`} width={40} height={44} className={cn('shrink-0 object-contain', className)} unoptimized />
}
