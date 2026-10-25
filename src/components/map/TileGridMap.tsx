import { Globe } from 'lucide-react'
import type { LocalityDataItem } from '../../types/election'
import { formatPct, formatSignedPP } from '../../utils/formatters'
import {
  getDivergentSwingFill,
  getLiveLeaderFill,
  type MapMetricMode,
} from '../../utils/geoProjection'

interface TileGridMapProps {
  localities: LocalityDataItem[]
  selectedCode: string | null
  highlightedCode: string | null
  metricMode?: MapMetricMode
  perspectiveSlot: 1 | 2
  isDark: boolean
  cand1Hex?: string
  cand2Hex?: string
  onSelectLocality: (loc: LocalityDataItem) => void
  onZoomToUf?: (uf: string) => void
}

/**
 * Posicionamento cartográfico em grade 8x7 das 27 UFs brasileiras (+ ZZ)
 * garantindo que estados territorialmente menores (DF, SE, AL, RN, PB, ES, RJ)
 * tenham exatamente a mesma área de leitura e toque que os demais.
 */
const BRAZIL_TILE_COORDS: Array<{
  uf: string
  row: number
  col: number
}> = [
  // Linha 0 (Extremo Norte)
  { uf: 'RR', row: 0, col: 2 },
  { uf: 'AP', row: 0, col: 4 },
  // Linha 1 (Norte + Nordeste Setentrional)
  { uf: 'AM', row: 1, col: 1 },
  { uf: 'PA', row: 1, col: 3 },
  { uf: 'MA', row: 1, col: 4 },
  { uf: 'CE', row: 1, col: 6 },
  { uf: 'RN', row: 1, col: 7 },
  // Linha 2 (Norte Sul + Meio-Norte + Nordeste Oriental)
  { uf: 'AC', row: 2, col: 0 },
  { uf: 'RO', row: 2, col: 1 },
  { uf: 'TO', row: 2, col: 3 },
  { uf: 'PI', row: 2, col: 5 },
  { uf: 'PB', row: 2, col: 7 },
  // Linha 3 (Centro-Oeste + Nordeste Meridional)
  { uf: 'MT', row: 3, col: 2 },
  { uf: 'GO', row: 3, col: 3 },
  { uf: 'DF', row: 3, col: 4 },
  { uf: 'BA', row: 3, col: 5 },
  { uf: 'PE', row: 3, col: 6 },
  { uf: 'AL', row: 3, col: 7 },
  // Linha 4 (Centro-Sul + Sudeste + Sergipe)
  { uf: 'MS', row: 4, col: 2 },
  { uf: 'MG', row: 4, col: 4 },
  { uf: 'ES', row: 4, col: 5 },
  { uf: 'SE', row: 4, col: 6 },
  // Linha 5 (Sudeste Meridional + Sul)
  { uf: 'PR', row: 5, col: 2 },
  { uf: 'SP', row: 5, col: 3 },
  { uf: 'RJ', row: 5, col: 4 },
  // Linha 6 (Extremo Sul + Exterior ZZ)
  { uf: 'SC', row: 6, col: 2 },
  { uf: 'RS', row: 6, col: 1 },
  { uf: 'ZZ', row: 6, col: 6 },
]

export function TileGridMap({
  localities,
  selectedCode,
  highlightedCode,
  metricMode = 'live_2t',
  perspectiveSlot,
  isDark,
  cand1Hex,
  cand2Hex,
  onSelectLocality,
  onZoomToUf,
}: TileGridMapProps) {
  const byUf = new Map<string, LocalityDataItem>()
  for (const loc of localities) {
    byUf.set(loc.uf.toUpperCase(), loc)
  }

  return (
    <div
      data-testid="tile-grid-map"
      role="region"
      aria-label="Mapa em grade de quadrados (Tile Grid) por Unidade da Federação"
      className="w-full overflow-x-auto py-2"
    >
      <div className="mx-auto grid min-w-[320px] max-w-2xl grid-cols-8 gap-1.5 sm:gap-2">
        {Array.from({ length: 7 * 8 }).map((_, cellIdx) => {
          const row = Math.floor(cellIdx / 8)
          const col = cellIdx % 8
          const tile = BRAZIL_TILE_COORDS.find(
            (t) => t.row === row && t.col === col,
          )
          if (!tile) {
            return (
              <div
                key={`empty-${row}-${col}`}
                aria-hidden="true"
                className="aspect-square"
              />
            )
          }

          const loc = byUf.get(tile.uf)
          if (!loc) {
            return (
              <div
                key={tile.uf}
                className="flex aspect-square items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-800/50"
              >
                {tile.uf}
              </div>
            )
          }

          const rawSwing =
            perspectiveSlot === 1 ? loc.cand1_swing_pp : loc.cand2_swing_pp
          const swingForColor = loc.net_swing_cand1_pp ?? loc.cand1_swing_pp
          const fillColor =
            metricMode === 'live_2t'
              ? getLiveLeaderFill(
                  loc.cand1_pct_2t,
                  loc.cand2_pct_2t,
                  loc.pct_counted,
                  isDark,
                  cand1Hex,
                  cand2Hex,
                )
              : getDivergentSwingFill(
                  swingForColor,
                  isDark,
                  2.5,
                  cand1Hex,
                  cand2Hex,
                )

          const isSelected =
            selectedCode === loc.code_tse || selectedCode === loc.uf
          const isHighlighted =
            highlightedCode === loc.code_tse ||
            highlightedCode === loc.uf ||
            loc.changed_in_last_cycle

          const liveMargin =
            loc.cand1_pct_2t !== null && loc.cand2_pct_2t !== null
              ? Math.abs(loc.cand1_pct_2t - loc.cand2_pct_2t)
              : 0
          const highSaturation =
            metricMode === 'live_2t'
              ? loc.pct_counted > 0 && liveMargin >= 3.5
              : swingForColor !== null && Math.abs(swingForColor) >= 1.1

          const leadPct =
            loc.cand1_pct_2t !== null && loc.cand2_pct_2t !== null
              ? Math.max(loc.cand1_pct_2t, loc.cand2_pct_2t)
              : null

          return (
            <button
              key={tile.uf}
              type="button"
              data-testid={`tile-uf-${tile.uf}`}
              onClick={() => onSelectLocality(loc)}
              onDoubleClick={() => {
                if (tile.uf !== 'ZZ' && onZoomToUf) {
                  onZoomToUf(tile.uf)
                }
              }}
              aria-label={`${loc.name} (${tile.uf}): ${formatPct(loc.pct_counted)} apurado`}
              style={{
                backgroundColor: fillColor,
                transition:
                  'background-color 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms ease',
              }}
              className={`group relative flex aspect-square flex-col items-center justify-between overflow-hidden rounded-xl border p-1 text-center shadow-2xs hover:scale-[1.04] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white ${
                isSelected
                  ? 'ring-2 ring-slate-950 border-slate-950 dark:ring-white dark:border-white'
                  : isHighlighted
                    ? 'border-amber-500 ring-2 ring-amber-400/80'
                    : loc.low_reliability
                      ? 'border-dashed border-slate-400 opacity-85 dark:border-slate-500'
                      : 'border-slate-300/80 dark:border-slate-700/80'
              } ${
                highSaturation
                  ? 'text-white'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {/* Sobreposição de hachura quando < 30% apurado */}
              {loc.low_reliability && (
                <span
                  aria-hidden="true"
                  className="low-reliability-hatch pointer-events-none absolute inset-0 opacity-45"
                />
              )}

              <span className="relative z-10 flex w-full items-center justify-between px-0.5 text-[10px] font-extrabold leading-none sm:text-xs">
                {tile.uf === 'ZZ' ? (
                  // Exterior: globo no lugar da sigla "ZZ", que não diz nada a quem visita
                  <span title="Exterior" className="inline-flex">
                    <Globe className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <span>{tile.uf}</span>
                )}
                {loc.low_reliability && (
                  <span
                    title="Menos de 30% apurado"
                    className="rounded bg-amber-500/90 px-0.5 text-[8px] font-bold text-slate-950"
                  >
                    &lt;30%
                  </span>
                )}
              </span>

              <span className="relative z-10 font-mono text-[9px] font-bold leading-tight sm:text-[11px]">
                {metricMode === 'live_2t' ? (
                  leadPct !== null ? (
                    formatPct(leadPct, 1)
                  ) : (
                    '0%'
                  )
                ) : rawSwing !== null ? (
                  <>
                    {rawSwing > 0 ? '▲' : rawSwing < 0 ? '▼' : ''}
                    {formatSignedPP(rawSwing).replace(' p.p.', '')}
                  </>
                ) : (
                  '0%'
                )}
              </span>

              <span className="relative z-10 text-[8px] font-medium opacity-80 sm:text-[9px]">
                {formatPct(loc.pct_counted, 0)}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
        Dica: toque em um quadrado para ver detalhes ou clique duas vezes (ou use
        o botão no cartão de detalhes) para abrir o mapa de municípios da UF.
      </p>
    </div>
  )
}
