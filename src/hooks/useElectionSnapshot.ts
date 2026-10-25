import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DisputeSnapshot,
  ElectionCatalogSnapshot,
  ReplayBundle,
} from '../types/election'

export type SimulationStage =
  | 'live'
  | '0pct'
  | '25pct'
  | '50tie'
  | '65pct'
  | '88pct'
  | '100pct'

const POLL_INTERVAL_MS = 30_000
const STALE_THRESHOLD_MS = 180_000 // 3 minutos

function getCachedSnapshot(disputeId: string): DisputeSnapshot | null {
  try {
    // v2: descarta caches antigos que podem conter os dados simulados publicados antes.
    const raw = window.localStorage.getItem(`apuracao2026_snap_v2_${disputeId}`)
    if (raw) {
      return JSON.parse(raw) as DisputeSnapshot
    }
  } catch {
    // Ignora falha de leitura no localStorage
  }
  return null
}

function saveCachedSnapshot(disputeId: string, snap: DisputeSnapshot): void {
  try {
    window.localStorage.setItem(
      `apuracao2026_snap_v2_${disputeId}`,
      JSON.stringify(snap),
    )
  } catch {
    // Ignora quota de storage
  }
}

export function useElectionSnapshot(
  disputeId: string,
  stage: SimulationStage = 'live',
) {
  const [catalog, setCatalog] = useState<ElectionCatalogSnapshot | null>(null)
  const [snapshot, setSnapshot] = useState<DisputeSnapshot | null>(() =>
    getCachedSnapshot(disputeId),
  )
  const [loading, setLoading] = useState<boolean>(() => !getCachedSnapshot(disputeId))
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [staleTimedOut, setStaleTimedOut] = useState<boolean>(false)
  const [snapshotAgeSeconds, setSnapshotAgeSeconds] = useState<number>(0)

  // Estado do modo Replay 2022
  const [isReplayMode, setIsReplayMode] = useState<boolean>(false)
  const [replayBundle, setReplayBundle] = useState<ReplayBundle | null>(null)
  const [replayFrameIndex, setReplayFrameIndex] = useState<number>(0)
  const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(false)
  const [replaySpeedMs, setReplaySpeedMs] = useState<number>(1800)

  const activeRequestRef = useRef<number>(0)
  const lastFetchedAtMsRef = useRef<number>(Date.now())
  const lastSnapSignatureRef = useRef<string>('')
  const lastCatSignatureRef = useRef<string>('')

  const basePrefix =
    stage === 'live' ? '/snapshots' : `/snapshots/stages/${stage}`

  const loadSnapshotAndCatalog = useCallback(async () => {
    const reqId = ++activeRequestRef.current
    try {
      const [catRes, snapRes] = await Promise.all([
        fetch(`${basePrefix}/catalog.json`, { cache: 'no-cache' }),
        fetch(`${basePrefix}/${disputeId}/latest.json`, { cache: 'no-cache' }),
      ])

      if (!catRes.ok || !snapRes.ok) {
        throw new Error(`HTTP ${snapRes.status}`)
      }

      const [catText, snapText] = await Promise.all([
        catRes.text(),
        snapRes.text(),
      ])

      if (reqId !== activeRequestRef.current) return

      const catData = JSON.parse(catText) as ElectionCatalogSnapshot
      const snapData = JSON.parse(snapText) as DisputeSnapshot

      // Só atualiza referência de estado se os dados da apuração ou disputa realmente mudaram,
      // evitando re-renders desnecessários e preservando scroll e estado local dos componentes.
      const snapSig = `${snapData.dispute_id}:${stage}:${snapData.generated_at_hms}:${snapData.sections.counted_sections}:${snapData.votes.valid_votes}:${snapData.candidates[0]?.photo_url ?? ''}`
      if (snapSig !== lastSnapSignatureRef.current) {
        lastSnapSignatureRef.current = snapSig
        setSnapshot(snapData)
      }

      const catSig = `${stage}:${catData.disputes.map((d) => `${d.dispute_id}:${d.pct_counted}:${d.cand1_pct}`).join('|')}`
      if (catSig !== lastCatSignatureRef.current) {
        lastCatSignatureRef.current = catSig
        setCatalog(catData)
      }

      lastFetchedAtMsRef.current = Date.now()
      setStaleTimedOut((prev) => (prev ? false : prev))
      setFetchError((prev) => (prev !== null ? null : prev))
      setLoading((prev) => (prev ? false : prev))

      if (stage === 'live') {
        saveCachedSnapshot(disputeId, snapData)
      }
    } catch (err) {
      if (reqId !== activeRequestRef.current) return
      const msg =
        err instanceof Error ? err.message : 'Indisponibilidade temporária'
      setFetchError((prev) => (prev !== msg ? msg : prev))
      setLoading((prev) => (prev ? false : prev))
    }
  }, [basePrefix, disputeId, stage])

  useEffect(() => {
    void loadSnapshotAndCatalog()

    // Jitter de até 5 s: evita milhares de abas batendo no CDN no mesmo segundo.
    const jitterMs = Math.floor(Math.random() * 5_000)
    const pollTimer = window.setInterval(() => {
      // Aba em segundo plano não gasta requisições (nem bateria do celular).
      if (!isReplayMode && document.visibilityState === 'visible') {
        void loadSnapshotAndCatalog()
      }
    }, POLL_INTERVAL_MS + jitterMs)

    // Ao voltar para a aba, atualiza na hora.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !isReplayMode) {
        void loadSnapshotAndCatalog()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadSnapshotAndCatalog, isReplayMode])

  // Verifica atraso > 3 minutos sem disparar re-renders a cada segundo quando tudo está em dia
  useEffect(() => {
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - lastFetchedAtMsRef.current
      const isNowTimedOut = elapsed > STALE_THRESHOLD_MS
      setStaleTimedOut((prev) => {
        if (prev !== isNowTimedOut) {
          setSnapshotAgeSeconds(Math.round(elapsed / 1000))
          return isNowTimedOut
        }
        return prev
      })
    }, 15_000)
    return () => window.clearInterval(tick)
  }, [])

  // Carrega bundle do Replay 2022 quando ativado
  const startReplay2022 = useCallback(
    async (initialFrame?: number, autoPlay = true) => {
      try {
        let bundle = replayBundle
        if (!bundle) {
          const res = await fetch('/snapshots/replay-2022/presidente.json')
          if (!res.ok) throw new Error('Falha ao carregar Replay 2022')
          bundle = (await res.json()) as ReplayBundle
          setReplayBundle(bundle)
        }
        const safeFrame =
          typeof initialFrame === 'number' && !Number.isNaN(initialFrame)
            ? Math.max(0, Math.min(bundle.frames.length - 1, initialFrame))
            : 0
        setIsReplayMode(true)
        setReplayFrameIndex(safeFrame)
        setIsReplayPlaying(autoPlay)
      } catch (err) {
        setFetchError(
          err instanceof Error ? err.message : 'Erro ao abrir Replay 2022',
        )
      }
    },
    [replayBundle],
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('replay') === '2022') {
      const f = Number(params.get('frame') ?? '13')
      void startReplay2022(f, false)
    }
  }, [startReplay2022])

  const stopReplay2022 = useCallback(() => {
    setIsReplayPlaying(false)
    setIsReplayMode(false)
  }, [])

  useEffect(() => {
    if (!isReplayMode || !isReplayPlaying || !replayBundle) return
    const timer = window.setInterval(() => {
      setReplayFrameIndex((prev) => {
        if (prev + 1 >= replayBundle.frames.length) {
          setIsReplayPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, replaySpeedMs)
    return () => window.clearInterval(timer)
  }, [isReplayMode, isReplayPlaying, replayBundle, replaySpeedMs])

  const activeSnapshot: DisputeSnapshot | null =
    isReplayMode && replayBundle && replayBundle.frames[replayFrameIndex]
      ? replayBundle.frames[replayFrameIndex]
      : snapshot

  const forceStaleParam =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('stale') === '1'
  const isStale =
    !isReplayMode &&
    (forceStaleParam || fetchError !== null || staleTimedOut)

  return {
    catalog,
    snapshot: activeSnapshot,
    loading,
    fetchError,
    isStale,
    snapshotAgeSeconds: forceStaleParam ? 225 : snapshotAgeSeconds,
    refreshNow: loadSnapshotAndCatalog,
    isReplayMode,
    replayBundle,
    replayFrameIndex,
    setReplayFrameIndex,
    isReplayPlaying,
    setIsReplayPlaying,
    replaySpeedMs,
    setReplaySpeedMs,
    startReplay2022,
    stopReplay2022,
  }
}
