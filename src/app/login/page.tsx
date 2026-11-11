'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { toast } from 'sonner'

import { InstitutionalLogin } from '@/components/app/institutional-login'
import type { LoggedInActor } from '@/components/app/login-form'
import { useApp } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { ActorView, Role } from '@/lib/contracts'

function LoginShell() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const setBootstrap = useApp((s) => s.setBootstrap)
  const setActor = useApp((s) => s.setActor)

  const { data: bootstrapData } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api.bootstrap(),
    retry: 1,
  })

  useEffect(() => {
    if (bootstrapData) {
      setBootstrap(bootstrapData)
    }
  }, [bootstrapData, setBootstrap])

  const handleLoggedIn = (a: LoggedInActor) => {
    const view: ActorView = {
      id: a.id,
      name: a.name,
      role: a.role as Role,
      jobTitle: a.jobTitle ?? null,
      parliamentarianId: a.parliamentarianId ?? null,
    }
    setActor(a.id, view)
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    toast.success(`Bem-vindo(a), ${a.name}!`, {
      description: 'Autenticado com sucesso no edocBR Plenário.',
    })
    router.push('/')
  }

  const handleBack = () => {
    router.push('/apresentacao')
  }

  return (
    <InstitutionalLogin
      onLoggedIn={handleLoggedIn}
      onBackToPresentation={handleBack}
    />
  )
}

export default function LoginPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
        },
      })
  )

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LoginShell />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

