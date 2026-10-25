import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Code2 } from 'lucide-react'

// Créditos da aplicação: um lugar só para nomes e links (cabeçalho e rodapé).
export const CRIADORES = [
  {
    nome: 'Luan Lopes',
    x: { usuario: 'alcoholicgoatt', url: 'https://x.com/alcoholicgoatt' },
    github: { usuario: 'lulkabral', url: 'https://github.com/lulkabral' },
  },
  {
    nome: 'Carlos Eduardo',
    x: { usuario: '1njusto', url: 'https://x.com/1njusto' },
    github: { usuario: '0justo', url: 'https://github.com/0justo' },
  },
] as const

export const REPO_URL = 'https://github.com/0justo/apuracao-eleicoes-2026'
export const TSE_URL = 'https://resultados.tse.jus.br'

function XIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function GitHubIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

const linkExterno = { target: '_blank', rel: 'noopener noreferrer' } as const

/** Botão "Criadores" do cabeçalho com popover (tema True Black). */
export function CreatorsMenu() {
  const [aberto, setAberto] = useState(false)
  const [posicao, setPosicao] = useState({ top: 0, right: 0 })
  const botaoRef = useRef<HTMLButtonElement>(null)
  const painelRef = useRef<HTMLDivElement>(null)
  const idPainel = useId()

  // O banner tem z-40 e o cabeçalho de disputas z-50: o popover vai para o body
  // (portal), em posição fixa logo abaixo do botão, para não ficar escondido.
  useEffect(() => {
    if (!aberto) return
    const posicionar = () => {
      const r = botaoRef.current?.getBoundingClientRect()
      if (r) setPosicao({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    }
    posicionar()
    const fecharFora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (!painelRef.current?.contains(alvo) && !botaoRef.current?.contains(alvo)) setAberto(false)
    }
    const fecharEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        botaoRef.current?.focus()
      }
    }
    window.addEventListener('resize', posicionar)
    window.addEventListener('scroll', posicionar, true)
    document.addEventListener('mousedown', fecharFora)
    document.addEventListener('keydown', fecharEsc)
    return () => {
      window.removeEventListener('resize', posicionar)
      window.removeEventListener('scroll', posicionar, true)
      document.removeEventListener('mousedown', fecharFora)
      document.removeEventListener('keydown', fecharEsc)
    }
  }, [aberto])

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        data-testid="creators-menu-button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={idPainel}
        aria-haspopup="dialog"
        title="Criadores do site"
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-1 focus:ring-slate-400 ${
          aberto
            ? 'border-slate-600 bg-slate-800 text-white'
            : 'border-slate-800 bg-slate-900/90 text-slate-200 hover:bg-slate-800 hover:text-white'
        }`}
      >
        <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Criadores</span>
      </button>

      {aberto &&
        createPortal(
          <div
            ref={painelRef}
            id={idPainel}
            role="dialog"
            aria-label="Criadores do site"
            data-testid="creators-menu"
            style={{ top: posicao.top, right: posicao.right }}
            className="fixed z-[70] w-64 rounded-xl border border-[#1F1F24] bg-[#050505] p-2 text-slate-200 shadow-2xl"
          >
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Criadores
            </p>
            <ul className="space-y-1">
              {CRIADORES.map((c) => (
                <li
                  key={c.nome}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]"
                >
                  <span className="text-xs font-semibold text-slate-100">{c.nome}</span>
                  <span className="flex items-center gap-1">
                    <a
                      href={c.x.url}
                      {...linkExterno}
                      aria-label={`X de ${c.nome} (@${c.x.usuario})`}
                      title={`X: @${c.x.usuario}`}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      <XIcon />
                    </a>
                    <a
                      href={c.github.url}
                      {...linkExterno}
                      aria-label={`GitHub de ${c.nome} (${c.github.usuario})`}
                      title={`GitHub: ${c.github.usuario}`}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      <GitHubIcon />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
            <a
              href={REPO_URL}
              {...linkExterno}
              className="mt-1.5 flex items-center gap-1.5 border-t border-[#1F1F24] px-2 pb-1 pt-2 text-[11px] text-slate-400 transition hover:text-white"
            >
              <GitHubIcon className="h-3 w-3" />
              Código aberto no GitHub
            </a>
          </div>,
          document.body,
        )}
    </>
  )
}

/** Linha discreta de créditos no fim do rodapé. */
export function CreditsLine() {
  const [luan, carlos] = CRIADORES
  const link = 'underline-offset-2 hover:text-slate-900 hover:underline dark:hover:text-slate-200'
  return (
    <p
      data-testid="footer-credits"
      className="border-t border-slate-200 pt-3 text-center text-[11px] text-slate-500 dark:border-[#1F1F24]"
    >
      Desenvolvido por{' '}
      <a href={luan.x.url} {...linkExterno} className={link}>
        {luan.nome} (@{luan.x.usuario})
      </a>{' '}
      e{' '}
      <a href={carlos.x.url} {...linkExterno} className={link}>
        {carlos.nome} (@{carlos.x.usuario})
      </a>{' '}
      •{' '}
      <a href={REPO_URL} {...linkExterno} className={link}>
        Código aberto no GitHub
      </a>{' '}
      •{' '}
      <a href={TSE_URL} {...linkExterno} className={link}>
        Dados oficiais TSE
      </a>
    </p>
  )
}
