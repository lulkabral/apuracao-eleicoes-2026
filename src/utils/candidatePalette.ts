/**
 * Sistema de Identidade Visual por Candidato e Partido (2º Turno 2026)
 *
 * Regras de cores temáticas:
 * - Lula (PT - 13) / candidatos do PT: Vermelho (#DC2626 modo claro / #EF4444 modo escuro)
 * - Flávio Bolsonaro (PL - 22) / adversário presidencial e PL: Azul (#1D4ED8 modo claro / #3B82F6 modo escuro)
 * - Governadores em 2º turno: paleta coerente e distinta baseada nos partidos de cada disputa
 *   (PT = Vermelho, PL / Republicanos = Azul, MDB = Esmeralda, PSD / PSDB = Âmbar/Ouro, PP / União = Ciano/Azul),
 *   garantindo sempre alto contraste entre os dois finalistas em modo claro e escuro.
 */

export type ThemeColorKey =
  | 'red'
  | 'blue'
  | 'emerald'
  | 'amber'
  | 'cyan'
  | 'indigo'

export interface CandidateVisualTheme {
  key: ThemeColorKey
  label: string
  hexLight: string
  hexDark: string
  hexSoftLight: string
  hexSoftDark: string
  borderClass: string
  cardBgClass: string
  badgeClass: string
  barClass: string
  avatarRingClass: string
  textAccentClass: string
  softPillClass: string
  dotClass: string
}

const THEMES: Record<ThemeColorKey, CandidateVisualTheme> = {
  red: {
    key: 'red',
    label: 'Vermelho',
    hexLight: '#DC2626',
    hexDark: '#EF4444',
    hexSoftLight: '#FEE2E2',
    hexSoftDark: '#450A0A',
    borderClass: 'border-red-400 dark:border-red-700/80',
    cardBgClass: 'bg-red-50/40 dark:bg-red-950/20',
    badgeClass: 'bg-red-600 text-white dark:bg-red-500',
    barClass: 'bg-red-600 dark:bg-red-500',
    avatarRingClass: 'ring-red-400 dark:ring-red-600',
    textAccentClass: 'text-red-700 dark:text-red-400',
    softPillClass:
      'border-red-300 bg-red-50 text-red-900 dark:border-red-800/70 dark:bg-red-950/60 dark:text-red-200',
    dotClass: 'bg-red-600 dark:bg-red-400',
  },
  blue: {
    key: 'blue',
    label: 'Azul',
    hexLight: '#1D4ED8',
    hexDark: '#3B82F6',
    hexSoftLight: '#DBEAFE',
    hexSoftDark: '#172554',
    borderClass: 'border-blue-400 dark:border-blue-700/80',
    cardBgClass: 'bg-blue-50/40 dark:bg-blue-950/20',
    badgeClass: 'bg-blue-700 text-white dark:bg-blue-600',
    barClass: 'bg-blue-600 dark:bg-blue-500',
    avatarRingClass: 'ring-blue-400 dark:ring-blue-600',
    textAccentClass: 'text-blue-700 dark:text-blue-400',
    softPillClass:
      'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/60 dark:text-blue-200',
    dotClass: 'bg-blue-600 dark:bg-blue-400',
  },
  emerald: {
    key: 'emerald',
    label: 'Verde Esmeralda',
    hexLight: '#059669',
    hexDark: '#10B981',
    hexSoftLight: '#D1FAE5',
    hexSoftDark: '#022C22',
    borderClass: 'border-emerald-400 dark:border-emerald-700/80',
    cardBgClass: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    badgeClass: 'bg-emerald-600 text-white dark:bg-emerald-500',
    barClass: 'bg-emerald-600 dark:bg-emerald-500',
    avatarRingClass: 'ring-emerald-400 dark:ring-emerald-600',
    textAccentClass: 'text-emerald-700 dark:text-emerald-400',
    softPillClass:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200',
    dotClass: 'bg-emerald-600 dark:bg-emerald-400',
  },
  amber: {
    key: 'amber',
    label: 'Âmbar / Ouro',
    hexLight: '#D97706',
    hexDark: '#F59E0B',
    hexSoftLight: '#FEF3C7',
    hexSoftDark: '#451A03',
    borderClass: 'border-amber-400 dark:border-amber-700/80',
    cardBgClass: 'bg-amber-50/40 dark:bg-amber-950/20',
    badgeClass: 'bg-amber-600 text-white dark:bg-amber-500',
    barClass: 'bg-amber-600 dark:bg-amber-500',
    avatarRingClass: 'ring-amber-400 dark:ring-amber-600',
    textAccentClass: 'text-amber-700 dark:text-amber-400',
    softPillClass:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
    dotClass: 'bg-amber-600 dark:bg-amber-400',
  },
  cyan: {
    key: 'cyan',
    label: 'Ciano / Celeste',
    hexLight: '#0891B2',
    hexDark: '#06B6D4',
    hexSoftLight: '#CFFAFE',
    hexSoftDark: '#083344',
    borderClass: 'border-cyan-400 dark:border-cyan-700/80',
    cardBgClass: 'bg-cyan-50/40 dark:bg-cyan-950/20',
    badgeClass: 'bg-cyan-700 text-white dark:bg-cyan-600',
    barClass: 'bg-cyan-600 dark:bg-cyan-500',
    avatarRingClass: 'ring-cyan-400 dark:ring-cyan-600',
    textAccentClass: 'text-cyan-700 dark:text-cyan-400',
    softPillClass:
      'border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-800/70 dark:bg-cyan-950/60 dark:text-cyan-200',
    dotClass: 'bg-cyan-600 dark:bg-cyan-400',
  },
  indigo: {
    key: 'indigo',
    label: 'Índigo',
    hexLight: '#4F46E5',
    hexDark: '#6366F1',
    hexSoftLight: '#E0E7FF',
    hexSoftDark: '#1E1B4B',
    borderClass: 'border-indigo-400 dark:border-indigo-700/80',
    cardBgClass: 'bg-indigo-50/40 dark:bg-indigo-950/20',
    badgeClass: 'bg-indigo-600 text-white dark:bg-indigo-500',
    barClass: 'bg-indigo-600 dark:bg-indigo-500',
    avatarRingClass: 'ring-indigo-400 dark:ring-indigo-600',
    textAccentClass: 'text-indigo-700 dark:text-indigo-400',
    softPillClass:
      'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200',
    dotClass: 'bg-indigo-600 dark:bg-indigo-400',
  },
}

function resolvePrimaryPartyKey(
  partyAcronym: string,
  number: string,
  _ballotName: string,
): ThemeColorKey {
  // Cor pela legenda (sigla/número oficial do TSE), nunca pelo nome: "CADU DE LULA" ou
  // sobrenomes de família não definem partido.
  const party = (partyAcronym || '').toUpperCase().trim()
  const num = (number || '').trim()

  if (party === 'PT' || num === '13') {
    return 'red'
  }
  if (party === 'PL' || num === '22') {
    return 'blue'
  }
  if (party === 'MDB' || num === '15') {
    return 'emerald'
  }
  if (party === 'PSD' || num === '55') {
    return 'amber'
  }
  if (party === 'PSDB' || num === '45') {
    return 'amber'
  }
  if (party === 'REPUBLICANOS' || num === '10') {
    return 'blue'
  }
  if (party === 'UNIÃO' || party === 'UNIAO' || num === '44') {
    return 'blue'
  }
  if (party === 'PP' || num === '11') {
    return 'cyan'
  }
  return 'blue'
}

/**
 * Retorna o par de temas visuais [temaCand1, temaCand2] garantindo cores partidárias
 * coerentes e distintas para os dois finalistas da disputa.
 */
export function getDisputePairThemes(
  cand1: { party_acronym?: string; number?: string; ballot_name?: string },
  cand2: { party_acronym?: string; number?: string; ballot_name?: string },
): [CandidateVisualTheme, CandidateVisualTheme] {
  const k1 = resolvePrimaryPartyKey(
    cand1.party_acronym || '',
    cand1.number || '',
    cand1.ballot_name || '',
  )
  let k2 = resolvePrimaryPartyKey(
    cand2.party_acronym || '',
    cand2.number || '',
    cand2.ballot_name || '',
  )

  // Se os dois partidos mapearem para o mesmo tom base (ex.: dois partidos de centro-direita),
  // diferencia o segundo candidato mantendo coerência partidária.
  if (k1 === k2) {
    if (k1 === 'blue') {
      k2 = 'amber'
    } else if (k1 === 'amber') {
      k2 = 'blue'
    } else {
      k2 = 'cyan'
    }
  }

  return [THEMES[k1], THEMES[k2]]
}

export function getCandidateTheme(
  cand: { party_acronym?: string; number?: string; ballot_name?: string },
  otherCand?: { party_acronym?: string; number?: string; ballot_name?: string },
  isFirstSlot = true,
): CandidateVisualTheme {
  if (otherCand) {
    const [t1, t2] = isFirstSlot
      ? getDisputePairThemes(cand, otherCand)
      : getDisputePairThemes(otherCand, cand)
    return isFirstSlot ? t1 : t2
  }
  const key = resolvePrimaryPartyKey(
    cand.party_acronym || '',
    cand.number || '',
    cand.ballot_name || '',
  )
  return THEMES[key]
}
