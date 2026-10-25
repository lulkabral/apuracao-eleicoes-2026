import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe, Minus, Plus, RotateCcw } from 'lucide-react'
import type { LocalityDataItem } from '../../types/election'
import {
  formatInt,
  formatOfficialCandidateName,
  formatPct,
  formatSignedPP,
} from '../../utils/formatters'
import {
  computeMercatorBounds,
  type DecodedGeoFeature,
  getDivergentSwingFill,
  getLiveLeaderFill,
  type MapMetricMode,
  type ProjectedFeature,
  projectFeaturesMercator,
} from '../../utils/geoProjection'

interface GeoChoroplethMapProps {
  features: DecodedGeoFeature[]
  munFeatures?: DecodedGeoFeature[]
  localities: LocalityDataItem[]
  scope: 'uf' | 'mu'
  zoomedUf?: string | null
  loadingMun?: boolean
  selectedCode: string | null
  highlightedCode: string | null
  focusedCode?: string | null
  metricMode?: MapMetricMode
  perspectiveSlot: 1 | 2
  isDark: boolean
  renderMode: 'svg' | 'canvas'
  cand1Hex?: string
  cand2Hex?: string
  cand1Name?: string
  cand2Name?: string
  onSelectLocality: (loc: LocalityDataItem) => void
  onZoomToUf?: (uf: string) => void
  onResetFocus?: () => void
  onResetZoom?: () => void
}

const MAP_WIDTH = 680
const MAP_HEIGHT = 540

function pointInProjectedRing(
  px: number,
  py: number,
  ring: Array<[number, number]>,
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function GeoChoroplethMap({
  features,
  munFeatures = [],
  localities,
  scope,
  zoomedUf = null,
  loadingMun = false,
  selectedCode,
  highlightedCode,
  focusedCode = null,
  metricMode = 'live_2t',
  perspectiveSlot,
  isDark,
  renderMode,
  cand1Hex = '#DC2626',
  cand2Hex = '#1D4ED8',
  cand1Name = 'Cand. 1',
  cand2Name = 'Cand. 2',
  onSelectLocality,
  onZoomToUf,
  onResetFocus,
  onResetZoom,
}: GeoChoroplethMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Estado interativo de Transformação (Zoom e Pan livre)
  const [scale, setScale] = useState<number>(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const scaleRef = useRef<number>(1)
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  scaleRef.current = scale
  panRef.current = pan

  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  const animateToTransform = useCallback(
    (nextScale: number, nextPan: { x: number; y: number }, duration = 400) => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      const startScale = scaleRef.current
      const startPan = { ...panRef.current }
      const startTime = performance.now()

      const step = (now: number) => {
        const elapsed = now - startTime
        const progress = Math.min(1, elapsed / duration)
        const ease = 1 - Math.pow(1 - progress, 3)

        const curScale = startScale + (nextScale - startScale) * ease
        const curPanX = startPan.x + (nextPan.x - startPan.x) * ease
        const curPanY = startPan.y + (nextPan.y - startPan.y) * ease

        setScale(curScale)
        setPan({ x: curPanX, y: curPanY })

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(step)
        } else {
          animFrameRef.current = null
        }
      }
      animFrameRef.current = requestAnimationFrame(step)
    },
    [],
  )

  const zoomToFeature = useCallback(
    (feat: ProjectedFeature) => {
      const [x0, y0, x1, y1] = feat.bboxPx
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const bw = Math.max(x1 - x0, 20)
      const bh = Math.max(y1 - y0, 20)
      const targetScale = Math.min(
        7.5,
        Math.max(1.8, Math.min(MAP_WIDTH / (bw * 1.35), MAP_HEIGHT / (bh * 1.35))),
      )
      const targetPan = {
        x: cx - MAP_WIDTH / 2,
        y: cy - MAP_HEIGHT / 2,
      }
      animateToTransform(targetScale, targetPan, 420)
    },
    [animateToTransform],
  )

  // Estado do Tooltip flutuante em True Black
  const [hoveredLoc, setHoveredLoc] = useState<LocalityDataItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  // Rastreamento de gestos táteis cooperativos e arrasto livre (drag/pan)
  const isDraggingRef = useRef<boolean>(false)
  const dragStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number }>({
    clientX: 0,
    clientY: 0,
    panX: 0,
    panY: 0,
  })
  const dragDistanceRef = useRef<number>(0)
  const activePointersRef = useRef<Map<number, { x: number; y: number; type: string }>>(new Map())
  const pinchStartDistRef = useRef<number>(0)
  const pinchStartScaleRef = useRef<number>(1)
  const [showTwoFingerToast, setShowTwoFingerToast] = useState<boolean>(false)
  const toastTimeoutRef = useRef<number | null>(null)

  const showTwoFingerHint = useCallback(() => {
    setShowTwoFingerToast(true)
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    toastTimeoutRef.current = window.setTimeout(() => {
      setShowTwoFingerToast(false)
      toastTimeoutRef.current = null
    }, 1500)
  }, [])

  const hideTwoFingerHint = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
      toastTimeoutRef.current = null
    }
    setShowTwoFingerToast(false)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    }
  }, [])

  const localityMap = useMemo(() => {
    const m = new Map<string, LocalityDataItem>()
    for (const loc of localities) {
      m.set(loc.code_tse.toUpperCase(), loc)
      m.set(loc.uf.toUpperCase(), loc)
      if (loc.code_ibge) m.set(loc.code_ibge, loc)
    }
    return m
  }, [localities])

  const brazilBounds = useMemo(
    () => (scope === 'uf' ? computeMercatorBounds(features) : undefined),
    [features, scope],
  )

  const projected: ProjectedFeature[] = useMemo(
    () => projectFeaturesMercator(features, MAP_WIDTH, MAP_HEIGHT, 22),
    [features],
  )

  const projectedMun: ProjectedFeature[] = useMemo(() => {
    if (!munFeatures || munFeatures.length === 0) return []
    if (scope === 'uf') {
      return projectFeaturesMercator(
        munFeatures,
        MAP_WIDTH,
        MAP_HEIGHT,
        22,
        brazilBounds,
      )
    }
    return []
  }, [munFeatures, scope, brazilBounds])

  const [munVisible, setMunVisible] = useState(false)
  useEffect(() => {
    if (projectedMun.length > 0) {
      const raf = requestAnimationFrame(() => {
        setMunVisible(true)
      })
      return () => {
        cancelAnimationFrame(raf)
        setMunVisible(false)
      }
    } else {
      setMunVisible(false)
    }
  }, [projectedMun.length])

  const findLocalityForFeature = useMemo(
    () =>
      (feat: ProjectedFeature): LocalityDataItem | undefined => {
        const codeTse = String(feat.properties.code_tse ?? feat.id).toUpperCase()
        const ufProp = String(feat.properties.uf ?? feat.id).toUpperCase()
        const ibgeProp = String(feat.properties.code_ibge ?? '')
        if (scope === 'uf') {
          return localityMap.get(ufProp) ?? localityMap.get(codeTse)
        }
        return localityMap.get(codeTse) ?? localityMap.get(ibgeProp)
      },
    [localityMap, scope],
  )

  const findLocalityForMunFeature = useMemo(
    () =>
      (feat: ProjectedFeature): LocalityDataItem | undefined => {
        const codeTse = String(feat.properties.code_tse ?? feat.id).toUpperCase()
        const ibgeProp = String(feat.properties.code_ibge ?? '')
        return localityMap.get(codeTse) ?? localityMap.get(ibgeProp)
      },
    [localityMap],
  )

  const getFeatureFill = useMemo(
    () =>
      (loc: LocalityDataItem | undefined): string => {
        if (metricMode === 'live_2t') {
          return getLiveLeaderFill(
            loc?.cand1_pct_2t ?? 0,
            loc?.cand2_pct_2t ?? 0,
            loc?.pct_counted ?? 0,
            isDark,
            cand1Hex,
            cand2Hex,
          )
        }
        const swingForColor =
          loc?.net_swing_cand1_pp ?? loc?.cand1_swing_pp ?? null
        return getDivergentSwingFill(
          swingForColor,
          isDark,
          2.5,
          cand1Hex,
          cand2Hex,
        )
      },
    [metricMode, isDark, cand1Hex, cand2Hex],
  )

  // Enquadramento automático suave quando focusedCode é definido via busca
  useEffect(() => {
    if (!focusedCode) {
      return
    }
    const norm = focusedCode.toUpperCase()
    const target = projected.find((feat) => {
      const codeTse = String(feat.properties.code_tse ?? feat.id).toUpperCase()
      const ufProp = String(feat.properties.uf ?? feat.id).toUpperCase()
      const ibgeProp = String(feat.properties.code_ibge ?? '').toUpperCase()
      return (
        (scope === 'uf' && ufProp === norm) ||
        codeTse === norm ||
        ibgeProp === norm
      )
    })
    if (target) {
      zoomToFeature(target)
      return
    }
    const targetMun = projectedMun.find((feat) => {
      const codeTse = String(feat.properties.code_tse ?? feat.id).toUpperCase()
      const ibgeProp = String(feat.properties.code_ibge ?? '').toUpperCase()
      return codeTse === norm || ibgeProp === norm
    })
    if (targetMun) {
      zoomToFeature(targetMun)
    }
  }, [focusedCode, projected, projectedMun, scope, zoomToFeature])

  // Auto-zoom suave (fitBounds) quando zoomedUf é definido
  useEffect(() => {
    if (!zoomedUf) {
      return
    }
    const norm = zoomedUf.toUpperCase()
    const target = projected.find((feat) => {
      const ufProp = String(feat.properties.uf ?? feat.id).toUpperCase()
      return ufProp === norm
    })
    if (!target) return
    zoomToFeature(target)
  }, [zoomedUf, projected, zoomToFeature])

  // Retorno suave ao Brasil quando zoomedUf é redefinido para null
  const prevZoomedUfRef = useRef<string | null>(zoomedUf ?? null)
  useEffect(() => {
    if (prevZoomedUfRef.current && !zoomedUf) {
      animateToTransform(1, { x: 0, y: 0 }, 380)
      setHoveredLoc(null)
    }
    prevZoomedUfRef.current = zoomedUf ?? null
  }, [zoomedUf, animateToTransform])

  // Reset de pan/zoom quando o escopo muda (apenas se não houver zoomedUf)
  useEffect(() => {
    if (!zoomedUf) {
      setScale(1)
      setPan({ x: 0, y: 0 })
      setHoveredLoc(null)
    }
  }, [scope, features, zoomedUf])

  // Cálculo da ViewBox derivada de scale e pan
  const viewBox = useMemo(() => {
    const currentScale = Math.max(1, scale)
    const vw = MAP_WIDTH / currentScale
    const vh = MAP_HEIGHT / currentScale

    const maxPanX = (MAP_WIDTH / 2) * (1 - 1 / currentScale)
    const maxPanY = (MAP_HEIGHT / 2) * (1 - 1 / currentScale)

    const clampedPanX = Math.max(-maxPanX, Math.min(maxPanX, pan.x))
    const clampedPanY = Math.max(-maxPanY, Math.min(maxPanY, pan.y))

    const vx = MAP_WIDTH / 2 + clampedPanX - vw / 2
    const vy = MAP_HEIGHT / 2 + clampedPanY - vh / 2

    return {
      vx,
      vy,
      vw,
      vh,
      scale: currentScale,
      isZoomed: currentScale > 1.05 || Boolean(focusedCode),
    }
  }, [scale, pan, focusedCode])

  // Zoom via roda do mouse (scroll) não-passivo
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2
      setScale((prevScale) => {
        const nextScale = Math.min(8, Math.max(1, prevScale * factor))
        if (nextScale === 1) {
          setPan({ x: 0, y: 0 })
        }
        return nextScale
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Gestores de Pointer cooperativos: 1 dedo rola a página, 2 dedos arrastam/pinçam o mapa
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
      })
      dragDistanceRef.current = 0

      if (e.pointerType === 'mouse') {
        isDraggingRef.current = true
        dragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          panX: pan.x,
          panY: pan.y,
        }
      } else {
        // Toque tátil (celular / tablet)
        if (activePointersRef.current.size === 1) {
          // 1 dedo: NÃO arrasta o mapa (deixa o navegador rolar a página verticalmente)
          dragStartRef.current = {
            clientX: e.clientX,
            clientY: e.clientY,
            panX: pan.x,
            panY: pan.y,
          }
          isDraggingRef.current = false
        } else if (activePointersRef.current.size === 2) {
          // 2 dedos: ativa arrasto e pinça cooperativos
          hideTwoFingerHint()
          isDraggingRef.current = true
          const pts = Array.from(activePointersRef.current.values())
          pinchStartDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          pinchStartScaleRef.current = scale
          const midX = (pts[0].x + pts[1].x) / 2
          const midY = (pts[0].y + pts[1].y) / 2
          dragStartRef.current = {
            clientX: midX,
            clientY: midY,
            panX: pan.x,
            panY: pan.y,
          }
        }
      }
    },
    [pan, scale, hideTwoFingerHint],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 1. Atualização imediata da posição do cursor para o Tooltip estar sempre ativo
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }

      if (!activePointersRef.current.has(e.pointerId)) return
      const prev = activePointersRef.current.get(e.pointerId)!
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: prev.type,
      })

      const isTouch = prev.type === 'touch'

      if (isTouch) {
        if (activePointersRef.current.size === 1) {
          // 1 dedo: detecta se o usuário está tentando arrastar o mapa e mostra aviso de 2 dedos
          const dx = e.clientX - dragStartRef.current.clientX
          const dy = e.clientY - dragStartRef.current.clientY
          const dist = Math.hypot(dx, dy)
          dragDistanceRef.current = dist
          if (dist > 18) {
            showTwoFingerHint()
          }
          return
        } else if (activePointersRef.current.size === 2) {
          // 2 dedos: pinch-to-zoom + pan simultâneos
          const pts = Array.from(activePointersRef.current.values())
          const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          if (pinchStartDistRef.current > 0) {
            const factor = currentDist / pinchStartDistRef.current
            const nextScale = Math.min(8, Math.max(1, pinchStartScaleRef.current * factor))
            setScale(nextScale)
          }

          const midX = (pts[0].x + pts[1].x) / 2
          const midY = (pts[0].y + pts[1].y) / 2
          const dx = midX - dragStartRef.current.clientX
          const dy = midY - dragStartRef.current.clientY

          const container = containerRef.current
          const rect = container?.getBoundingClientRect()
          const ratioX = rect ? MAP_WIDTH / (rect.width * scale) : 1
          const ratioY = rect ? MAP_HEIGHT / (rect.height * scale) : 1

          setPan({
            x: dragStartRef.current.panX - dx * ratioX,
            y: dragStartRef.current.panY - dy * ratioY,
          })
          dragDistanceRef.current = 20
          return
        }
      }

      // Arrasto livre (pan) com mouse no computador
      if (isDraggingRef.current && !isTouch) {
        const dx = e.clientX - dragStartRef.current.clientX
        const dy = e.clientY - dragStartRef.current.clientY
        const dist = Math.hypot(dx, dy)
        dragDistanceRef.current = dist

        if (dist > 3) {
          const container = containerRef.current
          const rect = container?.getBoundingClientRect()
          const ratioX = rect ? MAP_WIDTH / (rect.width * scale) : 1
          const ratioY = rect ? MAP_HEIGHT / (rect.height * scale) : 1

          setPan({
            x: dragStartRef.current.panX - dx * ratioX,
            y: dragStartRef.current.panY - dy * ratioY,
          })
        }
      }
    },
    [scale, showTwoFingerHint],
  )

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId)
    if (activePointersRef.current.size === 0) {
      isDraggingRef.current = false
    }
  }, [])

  // Resetar zoom para enquadramento inicial do Brasil com transição suave e limpeza de memória
  const handleResetZoom = useCallback(() => {
    animateToTransform(1, { x: 0, y: 0 }, 380)
    setHoveredLoc(null)
    onResetFocus?.()
    onResetZoom?.()
  }, [animateToTransform, onResetFocus, onResetZoom])

  // Aumentar zoom (+)
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(8, prev * 1.35))
  }, [])

  // Diminuir zoom (-)
  const handleZoomOut = useCallback(() => {
    setScale((prev) => {
      const next = Math.max(1, prev / 1.35)
      if (next === 1) setPan({ x: 0, y: 0 })
      return next
    })
  }, [])

  // Renderização em Canvas 2D
  useEffect(() => {
    if (renderMode !== 'canvas') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT)
    ctx.save()
    if (viewBox.isZoomed) {
      ctx.scale(viewBox.scale, viewBox.scale)
      ctx.translate(-viewBox.vx, -viewBox.vy)
    }

    for (const feat of projected) {
      const loc = findLocalityForFeature(feat)
      const fill = getFeatureFill(loc)
      const isSelected =
        loc &&
        (selectedCode === loc.code_tse ||
          (scope === 'uf' && selectedCode === loc.uf))

      ctx.beginPath()
      for (const ring of feat.projectedRings) {
        ring.forEach(([x, y], idx) => {
          if (idx === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
      }
      ctx.fillStyle = fill
      ctx.fill()

      if (loc?.low_reliability) {
        ctx.save()
        ctx.strokeStyle = isDark
          ? 'rgba(251, 191, 36, 0.55)'
          : 'rgba(180, 83, 9, 0.45)'
        ctx.setLineDash([3 / viewBox.scale, 3 / viewBox.scale])
        ctx.lineWidth = 1 / viewBox.scale
        ctx.stroke()
        ctx.restore()
      } else {
        ctx.strokeStyle = isSelected
          ? isDark
            ? '#ffffff'
            : '#0f172a'
          : isDark
            ? '#0f172a'
            : '#ffffff'
        ctx.lineWidth = (isSelected ? 2.2 : 0.75) / viewBox.scale
        ctx.stroke()
      }
    }

    if (projectedMun.length > 0) {
      for (const feat of projectedMun) {
        const loc = findLocalityForMunFeature(feat)
        const fill = getFeatureFill(loc)
        const isSelected = loc && selectedCode === loc.code_tse

        ctx.beginPath()
        for (const ring of feat.projectedRings) {
          ring.forEach(([x, y], idx) => {
            if (idx === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.closePath()
        }
        ctx.fillStyle = fill
        ctx.fill()

        ctx.strokeStyle = isSelected
          ? isDark
            ? '#ffffff'
            : '#0f172a'
          : isDark
            ? 'rgba(15, 23, 42, 0.75)'
            : 'rgba(255, 255, 255, 0.75)'
        ctx.lineWidth = (isSelected ? 2.0 : 0.45) / viewBox.scale
        ctx.stroke()
      }
    }

    ctx.restore()
  }, [
    renderMode,
    projected,
    projectedMun,
    findLocalityForFeature,
    findLocalityForMunFeature,
    getFeatureFill,
    selectedCode,
    isDark,
    scope,
    viewBox,
  ])

  // Canvas click e hover
  const handleCanvasPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragDistanceRef.current > 6) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = viewBox.vw / rect.width
    const scaleY = viewBox.vh / rect.height
    const px = viewBox.vx + (e.clientX - rect.left) * scaleX
    const py = viewBox.vy + (e.clientY - rect.top) * scaleY

    if (projectedMun.length > 0) {
      for (const feat of projectedMun) {
        const [x0, y0, x1, y1] = feat.bboxPx
        if (px < x0 || px > x1 || py < y0 || py > y1) continue
        for (const ring of feat.projectedRings) {
          if (pointInProjectedRing(px, py, ring)) {
            const loc = findLocalityForMunFeature(feat)
            if (loc) {
              onSelectLocality(loc)
            }
            return
          }
        }
      }
    }

    for (const feat of projected) {
      const [x0, y0, x1, y1] = feat.bboxPx
      if (px < x0 || px > x1 || py < y0 || py > y1) continue
      for (const ring of feat.projectedRings) {
        if (pointInProjectedRing(px, py, ring)) {
          const loc = findLocalityForFeature(feat)
          if (loc) {
            onSelectLocality(loc)
            if (scope === 'uf' && loc.uf !== 'ZZ' && loc.uf !== 'BR' && onZoomToUf) {
              onZoomToUf(loc.uf)
            }
          }
          zoomToFeature(feat)
          return
        }
      }
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = viewBox.vw / rect.width
    const scaleY = viewBox.vh / rect.height
    const px = viewBox.vx + (e.clientX - rect.left) * scaleX
    const py = viewBox.vy + (e.clientY - rect.top) * scaleY

    setTooltipPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })

    if (projectedMun.length > 0) {
      for (const feat of projectedMun) {
        const [x0, y0, x1, y1] = feat.bboxPx
        if (px < x0 || px > x1 || py < y0 || py > y1) continue
        for (const ring of feat.projectedRings) {
          if (pointInProjectedRing(px, py, ring)) {
            const loc = findLocalityForMunFeature(feat)
            setHoveredLoc(loc ?? null)
            return
          }
        }
      }
    }

    for (const feat of projected) {
      const [x0, y0, x1, y1] = feat.bboxPx
      if (px < x0 || px > x1 || py < y0 || py > y1) continue
      for (const ring of feat.projectedRings) {
        if (pointInProjectedRing(px, py, ring)) {
          const loc = findLocalityForFeature(feat)
          setHoveredLoc(loc ?? null)
          return
        }
      }
    }
    setHoveredLoc(null)
  }

  const viewBoxStr = `${viewBox.vx.toFixed(1)} ${viewBox.vy.toFixed(1)} ${viewBox.vw.toFixed(1)} ${viewBox.vh.toFixed(1)}`

  // Posição calculada com proteção contra estouro de bordas para o Tooltip Flutuante
  const tooltipStyle = useMemo(() => {
    if (!tooltipPos || !containerRef.current) return null
    const containerW = containerRef.current.clientWidth || MAP_WIDTH
    const containerH = containerRef.current.clientHeight || MAP_HEIGHT
    const tw = 224
    const th = 150

    let left = tooltipPos.x + 14
    let top = tooltipPos.y - 45

    if (left + tw > containerW - 12) {
      left = tooltipPos.x - tw - 14
    }
    if (left < 12) left = 12

    if (top + th > containerH - 12) {
      top = containerH - th - 12
    }
    if (top < 12) top = 12

    return { left: `${left}px`, top: `${top}px` }
  }, [tooltipPos])

  // Exterior (localidade "ZZ" de Presidente): não tem contorno no mapa, então aparece
  // como um encarte no canto, com a mesma cor e o mesmo clique de uma UF.
  const exterior =
    scope === 'uf'
      ? localities.find((l) => l.code_tse === 'ZZ' || l.uf === 'ZZ')
      : undefined
  const exteriorTemVotos = (exterior?.valid_votes_2t ?? 0) > 0

  // Identificação do candidato líder na localidade sob hover
  const isCand1Leader = hoveredLoc ? (hoveredLoc.cand1_pct_2t ?? 0) >= (hoveredLoc.cand2_pct_2t ?? 0) : false
  const isCand2Leader = hoveredLoc ? (hoveredLoc.cand2_pct_2t ?? 0) > (hoveredLoc.cand1_pct_2t ?? 0) : false

  return (
    <div
      ref={containerRef}
      data-testid={renderMode === 'canvas' ? 'geo-choropleth-canvas-wrapper' : 'geo-choropleth-svg-wrapper'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoveredLoc(null)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredLoc(null)}
      className="relative mx-auto w-full max-h-[60vh] sm:max-h-[70vh] lg:max-h-[75vh] overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100/40 select-none touch-pan-y dark:border-[#1F1F24] dark:bg-[#0F0F12] flex items-center justify-center"
      style={{ cursor: isDraggingRef.current ? 'grabbing' : 'grab' }}
    >
      {/* Aviso discreto sobre o mapa no celular se tentar arrastar com 1 dedo */}
      {showTwoFingerToast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-2xs transition-opacity duration-200"
        >
          <div className="rounded-xl border border-white/20 bg-slate-950/95 px-4 py-2.5 text-center text-xs font-semibold text-white shadow-2xl">
            Use dois dedos para mover o mapa
          </div>
        </div>
      )}

      {/* Indicador sutil de carregamento de municípios sob demanda */}
      {loadingMun && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/90 px-3.5 py-1.5 text-xs font-medium text-slate-200 shadow-xl backdrop-blur-md"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>Carregando municípios de {zoomedUf}...</span>
        </div>
      )}

      {/* Botões Flutuantes e Discretos de Zoom e Pan no Canto do Mapa (Área mínima de 44x44px no mobile) */}
      <div
        data-testid="map-zoom-controls"
        className="absolute bottom-3 right-3 z-30 flex flex-col gap-1 rounded-xl border border-white/15 bg-[#050505]/90 p-1 shadow-2xl backdrop-blur-md"
      >
        <button
          type="button"
          data-testid="map-zoom-in-btn"
          onClick={handleZoomIn}
          aria-label="Aumentar zoom"
          title="Aumentar zoom (+)"
          className="flex h-11 w-11 sm:h-8 sm:w-8 min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] items-center justify-center rounded-lg text-white hover:bg-white/15 active:bg-white/25 transition"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="map-zoom-out-btn"
          onClick={handleZoomOut}
          aria-label="Diminuir zoom"
          title="Diminuir zoom (-)"
          className="flex h-11 w-11 sm:h-8 sm:w-8 min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] items-center justify-center rounded-lg text-white hover:bg-white/15 active:bg-white/25 transition"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="map-reset-zoom-btn"
          onClick={handleResetZoom}
          aria-label="Resetar enquadramento do Brasil"
          title="Resetar enquadramento (⟲)"
          className="flex h-11 w-11 sm:h-8 sm:w-8 min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] items-center justify-center rounded-lg text-white hover:bg-white/15 active:bg-white/25 transition"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Encarte do Exterior (votos de brasileiros fora do país) */}
      {exterior && (
        <button
          type="button"
          data-testid="map-exterior-inset"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onSelectLocality(exterior)}
          aria-label={`Exterior: ${formatPct(exterior.pct_counted)} das seções apuradas${
            exteriorTemVotos
              ? `; ${cand1Name ?? 'candidato 1'} ${formatPct(exterior.cand1_pct_2t)}, ${cand2Name ?? 'candidato 2'} ${formatPct(exterior.cand2_pct_2t)}`
              : '; aguardando votos'
          }. Ver detalhes`}
          title="Votos do exterior — ver detalhes"
          className={`absolute bottom-3 left-3 z-30 flex items-center gap-2 rounded-xl border bg-[#050505]/90 p-1 text-left shadow-2xl backdrop-blur-md transition hover:bg-[#050505] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:p-1.5 sm:pr-2.5 ${
            selectedCode === exterior.code_tse ? 'border-white/80' : 'border-white/15'
          }`}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/20"
            style={{
              backgroundColor: getFeatureFill(exterior),
              opacity: exterior.low_reliability ? 0.72 : 1,
            }}
            aria-hidden="true"
          >
            <Globe className="h-5 w-5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
          </span>
          {/* No celular o mapa é pequeno: fica só o quadrado com o globo (sem cobrir o Sul) */}
          <span className="hidden leading-tight sm:block" aria-hidden="true">
            <span className="block text-[11px] font-bold text-white">Exterior</span>
            {exteriorTemVotos ? (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold tabular-nums text-slate-200">
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cand1Hex }} />
                  {formatPct(exterior.cand1_pct_2t, 1)}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cand2Hex }} />
                  {formatPct(exterior.cand2_pct_2t, 1)}
                </span>
              </span>
            ) : (
              <span className="block text-[10px] text-slate-300">Aguardando votos</span>
            )}
            <span className="block text-[10px] text-slate-400">
              {formatPct(exterior.pct_counted, 1)} apurado
            </span>
          </span>
        </button>
      )}

      {/* Botão legado para redefinir zoom quando focado */}
      {viewBox.isZoomed && onResetFocus && (
        <button
          type="button"
          data-testid="reset-map-focus-btn"
          onClick={handleResetZoom}
          className="absolute right-2.5 top-2.5 z-20 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
        >
          Redefinir zoom
        </button>
      )}

      {/* Tooltip / Pop-up Informativo Flutuante em True Black */}
      {hoveredLoc && tooltipStyle && (
        <div
          data-testid="map-hover-tooltip"
          style={tooltipStyle}
          className="pointer-events-none absolute z-40 w-56 rounded-xl border border-white/20 bg-[#050505]/95 p-2.5 text-white shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
            <div className="truncate font-extrabold text-xs text-white">
              {hoveredLoc.name}{' '}
              <span className="font-semibold text-slate-400">({hoveredLoc.uf})</span>
            </div>
            <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
              {formatPct(hoveredLoc.pct_counted)}
            </span>
          </div>

          <div className="mt-2 space-y-1.5">
            {/* Candidato 1 */}
            <div
              className={`flex items-center justify-between rounded-lg px-2 py-1 transition ${
                isCand1Leader ? 'bg-white/10 ring-1 ring-white/20' : 'bg-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: cand1Hex }}
                />
                <span className="truncate text-[11px] font-bold text-slate-200">
                  {formatOfficialCandidateName(cand1Name)}
                </span>
                {isCand1Leader && (
                  <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-black uppercase text-emerald-400">
                    Líder
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-black text-white">
                  {formatPct(hoveredLoc.cand1_pct_2t)}
                </div>
                <div className="font-mono text-[9px] text-slate-400">
                  {formatInt(hoveredLoc.cand1_votes_2t)} votos
                </div>
              </div>
            </div>

            {/* Candidato 2 */}
            <div
              className={`flex items-center justify-between rounded-lg px-2 py-1 transition ${
                isCand2Leader ? 'bg-white/10 ring-1 ring-white/20' : 'bg-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: cand2Hex }}
                />
                <span className="truncate text-[11px] font-bold text-slate-200">
                  {formatOfficialCandidateName(cand2Name)}
                </span>
                {isCand2Leader && (
                  <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-black uppercase text-emerald-400">
                    Líder
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-black text-white">
                  {formatPct(hoveredLoc.cand2_pct_2t)}
                </div>
                <div className="font-mono text-[9px] text-slate-400">
                  {formatInt(hoveredLoc.cand2_votes_2t)} votos
                </div>
              </div>
            </div>

            {metricMode === 'swing_1t' && (
              <div className="border-t border-white/10 pt-1 text-[10px] text-slate-300">
                Variação ({perspectiveSlot === 1 ? formatOfficialCandidateName(cand1Name) : formatOfficialCandidateName(cand2Name)}):{' '}
                {formatSignedPP(
                  perspectiveSlot === 1
                    ? (hoveredLoc.cand1_swing_pp ?? hoveredLoc.net_swing_cand1_pp)
                    : (hoveredLoc.cand2_swing_pp ?? (hoveredLoc.net_swing_cand1_pp !== null && hoveredLoc.net_swing_cand1_pp !== undefined ? -hoveredLoc.net_swing_cand1_pp : null)),
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {renderMode === 'canvas' ? (
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          onClick={handleCanvasPointer}
          onMouseMove={handleCanvasMouseMove}
          className="h-auto w-full cursor-pointer"
          aria-label={
            scope === 'uf'
              ? 'Mapa geográfico por UF em Canvas'
              : 'Mapa geográfico municipal em Canvas'
          }
        />
      ) : (
        <svg
          viewBox={viewBoxStr}
          role="img"
          aria-label={
            scope === 'uf'
              ? 'Mapa geográfico oficial do IBGE por Unidade da Federação'
              : 'Mapa geográfico oficial do IBGE por município'
          }
          className="max-h-[60vh] sm:max-h-[70vh] lg:max-h-[75vh] w-auto h-auto select-none object-contain"
        >
          <defs>
            <filter id="brazil-live-aura" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern
              id="map-low-reliability-hatch"
              width="8"
              height="8"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke={isDark ? '#f8fafc' : '#0f172a'}
                strokeWidth="2"
                strokeOpacity="0.32"
              />
            </pattern>
          </defs>

          <g>
            {/* Contorno sutil em pulso de luz (aura esmeralda/ciano) indicando dados em tempo real */}
            {scope === 'uf' && (
              <g aria-hidden="true" className="pointer-events-none" pointerEvents="none">
                {projected.map((feat) => (
                  <path
                    key={`glow-${feat.id}`}
                    d={feat.svgPath}
                    fill="none"
                    stroke={isDark ? '#06b6d4' : '#10b981'}
                    strokeWidth={3 / Math.pow(viewBox.scale, 0.65)}
                    strokeOpacity={isDark ? 0.45 : 0.35}
                    filter="url(#brazil-live-aura)"
                    className="animate-pulse pointer-events-none"
                    pointerEvents="none"
                  />
                ))}
              </g>
            )}

            {projected.map((feat) => {
              const loc = findLocalityForFeature(feat)
              const fillColor = getFeatureFill(loc)
              const isSelected =
                loc &&
                (selectedCode === loc.code_tse ||
                  (scope === 'uf' && selectedCode === loc.uf))
              const isHighlighted =
                loc &&
                (highlightedCode === loc.code_tse ||
                  (scope === 'uf' && highlightedCode === loc.uf) ||
                  loc.changed_in_last_cycle)
              const hasRecentChange = Boolean(loc?.changed_in_last_cycle)
              const codeAttr =
                scope === 'uf'
                  ? String(feat.properties.uf ?? feat.id)
                  : String(feat.properties.code_tse ?? feat.id)

              return (
                <g
                  key={feat.id}
                  data-testid={`geo-feature-${codeAttr}`}
                  onClick={() => {
                    if (dragDistanceRef.current > 6) return
                    if (loc) {
                      onSelectLocality(loc)
                      if (scope === 'uf' && loc.uf !== 'ZZ' && loc.uf !== 'BR' && onZoomToUf) {
                        onZoomToUf(loc.uf)
                      }
                    }
                    zoomToFeature(feat)
                  }}
                  onDoubleClick={() => {
                    if (scope === 'uf' && loc && loc.uf !== 'ZZ' && onZoomToUf) {
                      onZoomToUf(loc.uf)
                    }
                  }}
                  onPointerEnter={(e) => {
                    setHoveredLoc(loc ?? null)
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect()
                      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }
                  }}
                  onPointerMove={(e) => {
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect()
                      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }
                  }}
                  onPointerLeave={() => setHoveredLoc(null)}
                  onMouseEnter={(e) => {
                    setHoveredLoc(loc ?? null)
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect()
                      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }
                  }}
                  onMouseMove={(e) => {
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect()
                      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }
                  }}
                  onMouseLeave={() => setHoveredLoc(null)}
                  className="cursor-pointer"
                >
                  <path
                    d={feat.svgPath}
                    fill={fillColor}
                    fillOpacity={loc?.low_reliability ? 0.72 : 1}
                    stroke={
                      isSelected
                        ? isDark
                          ? '#ffffff'
                          : '#0f172a'
                        : hasRecentChange
                          ? '#f59e0b'
                          : isHighlighted
                            ? '#f59e0b'
                            : isDark
                              ? '#0f172a'
                              : '#ffffff'
                    }
                    strokeWidth={
                      (isSelected
                        ? 2.4
                        : hasRecentChange
                          ? 2.2
                          : isHighlighted
                            ? 1.8
                            : scope === 'uf'
                              ? 1.05
                              : 0.55) / Math.pow(viewBox.scale, 0.65)
                    }
                    style={{
                      transition:
                        'fill 420ms cubic-bezier(0.22, 1, 0.36, 1), stroke-width 180ms ease',
                      filter: hasRecentChange
                        ? 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.85))'
                        : undefined,
                    }}
                    className={`hover:brightness-110 ${hasRecentChange ? 'animate-pulse' : ''}`}
                  />

                  {loc?.low_reliability && (
                    <path
                      d={feat.svgPath}
                      fill="url(#map-low-reliability-hatch)"
                      pointerEvents="none"
                    />
                  )}
                </g>
              )
            })}

            {/* Camada detalhada de municípios (sob demanda / Zoom Semântico) com transição suave de opacidade */}
            {projectedMun.length > 0 && (
              <g
                data-testid="municipalities-layer"
                className="transition-opacity duration-500 ease-out"
                style={{
                  opacity: munVisible ? 1 : 0,
                  pointerEvents: munVisible ? 'auto' : 'none',
                }}
              >
                {projectedMun.map((feat) => {
                  const loc = findLocalityForMunFeature(feat)
                  const fillColor = getFeatureFill(loc)
                  const isSelected =
                    loc && selectedCode === loc.code_tse
                  const isHighlighted =
                    loc &&
                    (highlightedCode === loc.code_tse ||
                      loc.changed_in_last_cycle)
                  const hasRecentChange = Boolean(loc?.changed_in_last_cycle)
                  const codeAttr = String(feat.properties.code_tse ?? feat.id)

                  return (
                    <g
                      key={`mun-${feat.id}`}
                      data-testid={`geo-mun-feature-${codeAttr}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (dragDistanceRef.current > 6) return
                        if (loc) {
                          onSelectLocality(loc)
                        }
                      }}
                      onPointerEnter={(e) => {
                        setHoveredLoc(loc ?? null)
                        if (containerRef.current) {
                          const rect = containerRef.current.getBoundingClientRect()
                          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                        }
                      }}
                      onPointerMove={(e) => {
                        if (containerRef.current) {
                          const rect = containerRef.current.getBoundingClientRect()
                          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                        }
                      }}
                      onPointerLeave={() => setHoveredLoc(null)}
                      onMouseEnter={(e) => {
                        setHoveredLoc(loc ?? null)
                        if (containerRef.current) {
                          const rect = containerRef.current.getBoundingClientRect()
                          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                        }
                      }}
                      onMouseMove={(e) => {
                        if (containerRef.current) {
                          const rect = containerRef.current.getBoundingClientRect()
                          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
                        }
                      }}
                      onMouseLeave={() => setHoveredLoc(null)}
                      className="cursor-pointer"
                    >
                      <path
                        d={feat.svgPath}
                        fill={fillColor}
                        fillOpacity={loc?.low_reliability ? 0.72 : 1}
                        stroke={
                          isSelected
                            ? isDark
                              ? '#ffffff'
                              : '#0f172a'
                            : hasRecentChange
                              ? '#f59e0b'
                              : isHighlighted
                                ? '#f59e0b'
                                : isDark
                                  ? 'rgba(15, 23, 42, 0.75)'
                                  : 'rgba(255, 255, 255, 0.75)'
                        }
                        strokeWidth={
                          (isSelected
                            ? 2.2
                            : hasRecentChange
                              ? 1.8
                              : isHighlighted
                                ? 1.4
                                : 0.45) / Math.pow(viewBox.scale, 0.65)
                        }
                        style={{
                          transition:
                            'fill 350ms cubic-bezier(0.22, 1, 0.36, 1), stroke-width 180ms ease',
                        }}
                        className="hover:brightness-110"
                      />

                      {loc?.low_reliability && (
                        <path
                          d={feat.svgPath}
                          fill="url(#map-low-reliability-hatch)"
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  )
                })}
              </g>
            )}
          </g>

          {/* Rótulos das UFs ou capitais */}
          <g pointerEvents="none" className="pointer-events-none">
            {projected.map((feat) => {
              const loc = findLocalityForFeature(feat)
              const isSelected =
                loc &&
                (selectedCode === loc.code_tse ||
                  (scope === 'uf' && selectedCode === loc.uf))
              if (scope === 'mu' && !loc?.is_capital && !isSelected) {
                return null
              }
              const label =
                scope === 'uf'
                  ? String(feat.properties.uf ?? feat.id)
                  : String(feat.properties.name ?? '')
              const [cx, cy] = feat.centroidPx
              const fontSize = Math.max(
                5.5,
                10 / Math.pow(viewBox.scale, 0.65),
              )
              return (
                <text
                  key={`lbl-${feat.id}`}
                  x={cx}
                  y={cy}
                  fontSize={fontSize}
                  textAnchor="middle"
                  dominantBaseline="central"
                  pointerEvents="none"
                  className="fill-slate-950 font-sans font-extrabold drop-shadow-[0_1px_2px_rgba(255,255,255,0.85)] dark:fill-white dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] pointer-events-none"
                >
                  {label}
                </text>
              )
            })}

            {/* Rótulos dos municípios carregados sob demanda */}
            {projectedMun.length > 0 &&
              projectedMun.map((feat) => {
                const loc = findLocalityForMunFeature(feat)
                const isSelected = loc && selectedCode === loc.code_tse
                if (!loc?.is_capital && !isSelected) {
                  return null
                }
                const label = String(feat.properties.name ?? loc?.name ?? '')
                const [cx, cy] = feat.centroidPx
                const fontSize = Math.max(5.5, 9 / Math.pow(viewBox.scale, 0.65))
                return (
                  <text
                    key={`lbl-mun-${feat.id}`}
                    x={cx}
                    y={cy}
                    fontSize={fontSize}
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                    className="fill-slate-950 font-sans font-extrabold drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)] dark:fill-white dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] pointer-events-none"
                  >
                    {label}
                  </text>
                )
              })}
          </g>
        </svg>
      )}
    </div>
  )
}
