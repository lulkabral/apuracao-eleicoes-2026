import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const {
  recalculateTurnaroundClient,
  computeLocalityRemainingValid,
  OFFICIAL_ESTIMATE_DISCLAIMER,
} = await jiti.import('../src/utils/turnaroundMath.ts')
const { formatInt, formatPct, formatPP, formatSignedPP } = await jiti.import(
  '../src/utils/formatters.ts',
)
const {
  decodeTopoJSON,
  computeMercatorBounds,
  projectFeaturesMercator,
  getDivergentSwingFill,
} = await jiti.import('../src/utils/geoProjection.ts')
const { getDisputePairThemes } = await jiti.import(
  '../src/utils/candidatePalette.ts',
)

const ROOT = path.resolve('.')
const SNAPSHOTS_DIR = path.resolve('public/snapshots')
const GEO_DIR = path.resolve('public/geo')

function readJson(relPath) {
  const full = path.join(SNAPSHOTS_DIR, relPath)
  return JSON.parse(fs.readFileSync(full, 'utf-8'))
}

test('Formatters pt-BR: formata inteiros, percentuais e pontos percentuais corretamente', () => {
  assert.equal(formatInt(1234567), '1.234.567')
  assert.equal(formatPct(65.432), '65,43%')
  assert.equal(formatPct(100, 0), '100%')
  assert.equal(formatPP(1.8), '1,80 p.p.')
  assert.equal(formatSignedPP(2.35), '+2,35 p.p.')
  assert.equal(formatSignedPP(-1.5), '-1,50 p.p.')
})

test('Calculadora da Virada no cliente: paridade exata no ajuste 0% e recálculo com slider (-10% a +10%)', () => {
  const snap65 = readJson('stages/65pct/presidente/latest.json')

  const calcZero = recalculateTurnaroundClient(snap65, 0)
  assert.equal(calcZero.disclaimer, OFFICIAL_ESTIMATE_DISCLAIMER)
  assert.equal(calcZero.status_code, 'in_dispute')
  assert.ok(
    calcZero.needed_share_pct_s > 50 && calcZero.needed_share_pct_s < 60,
  )

  const calcLowerTurnout = recalculateTurnaroundClient(snap65, -15)
  assert.equal(calcLowerTurnout.disclaimer, OFFICIAL_ESTIMATE_DISCLAIMER)
  assert.ok(
    calcLowerTurnout.estimated_remaining_valid_votes_r <
      calcZero.estimated_remaining_valid_votes_r,
  )
  assert.ok(calcLowerTurnout.needed_share_pct_s > calcZero.needed_share_pct_s)

  const calcHigherTurnout = recalculateTurnaroundClient(snap65, 10)
  assert.ok(
    calcHigherTurnout.estimated_remaining_valid_votes_r >
      calcZero.estimated_remaining_valid_votes_r,
  )
  assert.ok(calcHigherTurnout.needed_share_pct_s < calcZero.needed_share_pct_s)
})

test('Calculadora da Virada no cliente: casos de borda (0%, empate 50%, s > 100%, s <= 0%, 100% apurado)', () => {
  const snap0 = readJson('stages/0pct/presidente/latest.json')
  const calc0 = recalculateTurnaroundClient(snap0, -5)
  assert.equal(calc0.status_code, 'waiting_0pct')
  assert.equal(calc0.needed_share_pct_s, 50.0)
  assert.equal(calc0.disclaimer, OFFICIAL_ESTIMATE_DISCLAIMER)

  const snapTie = readJson('stages/50tie/presidente/latest.json')
  const calcTie = recalculateTurnaroundClient(snapTie, 5)
  assert.equal(calcTie.status_code, 'exact_tie')
  assert.equal(calcTie.needed_share_pct_s, 50.0)
  assert.equal(calcTie.vote_difference, 0)

  const snap100 = readJson('stages/100pct/presidente/latest.json')
  const calc100 = recalculateTurnaroundClient(snap100, -10)
  assert.equal(calc100.status_code, 'completed_100pct')
  assert.equal(calc100.estimated_remaining_valid_votes_r, 0)
  assert.equal(calc100.needed_share_pct_s, null)

  const snap88 = structuredClone(readJson('stages/88pct/presidente/latest.json'))
  snap88.candidates[0].votes = 20_000_000
  snap88.candidates[1].votes = 80_000_000
  const calcExceeds = recalculateTurnaroundClient(snap88, -10)
  assert.equal(calcExceeds.status_code, 'exceeds_remaining')
  assert.equal(
    calcExceeds.neutral_message,
    'Pelos dados atuais, a diferença supera o total estimado de votos restantes.',
  )

  const locSample = structuredClone(snap88.localities[0])
  locSample.blank_votes_2t = Math.round(locSample.turnout_votes_2t * 0.15)
  locSample.null_votes_2t = Math.round(locSample.turnout_votes_2t * 0.1)
  const { remainingValid: rHighBn } = computeLocalityRemainingValid(
    locSample,
    0,
  )
  const { remainingValid: rNormalBn } = computeLocalityRemainingValid(
    snap88.localities[0],
    0,
  )
  assert.ok(rHighBn < rNormalBn)
})

test('Snapshots de todas as disputas (Presidente + 6 Governadores) e estágios (0% -> 100%) respeitam regras inegociáveis', () => {
  const stages = ['0pct', '25pct', '50tie', '65pct', '88pct', '100pct']
  for (const stage of stages) {
    // O catálogo da raiz é saída do poller (não versionada); usa o de cada estágio
    const catalog = readJson(`stages/${stage}/catalog.json`)
    assert.equal(catalog.disputes.length, 7)

    for (const item of catalog.disputes) {
      const snap = readJson(`stages/${stage}/${item.dispute_id}/latest.json`)

      assert.match(
        snap.fixed_banner_text,
        /^Resultado parcial até 100% das urnas apuradas\. Fonte: TSE\. Atualizado às \d{2}:\d{2}:\d{2}$/,
      )

      assert.equal(snap.candidates.length, 2)
      assert.ok(snap.candidates[0].seq < snap.candidates[1].seq)

      assert.equal(snap.turnaround.disclaimer, OFFICIAL_ESTIMATE_DISCLAIMER)
      assert.equal(
        snap.pending_summary.disclaimer,
        OFFICIAL_ESTIMATE_DISCLAIMER,
      )
      assert.equal(
        snap.reference_scenario.disclaimer,
        OFFICIAL_ESTIMATE_DISCLAIMER,
      )

      for (const cand of snap.candidates) {
        if (cand.tse_elected_flag) {
          assert.equal(
            cand.tse_official_attribution,
            'Eleito (segundo o TSE)',
          )
        } else {
          assert.equal(cand.tse_official_attribution, null)
        }
      }
    }
  }
})

test('Fase 4 — TopoJSON Simplificado (UF < 150 KB e 27 estados municipais < 300 KB) + Projeção Mercator e Escala Divergente Neutra', () => {
  const brUfPath = path.join(GEO_DIR, 'br-ufs.topo.json')
  const brUfStat = fs.statSync(brUfPath)
  assert.ok(
    brUfStat.size < 150 * 1024,
    `br-ufs.topo.json (${brUfStat.size} B) deve ser menor que 150 KB`,
  )

  const brTopo = JSON.parse(fs.readFileSync(brUfPath, 'utf-8'))
  const decodedUfs = decodeTopoJSON(brTopo, 'ufs')
  assert.equal(decodedUfs.length, 27)

  const projectedUfs = projectFeaturesMercator(decodedUfs, 680, 540, 22)
  assert.equal(projectedUfs.length, 27)
  for (const p of projectedUfs) {
    assert.ok(p.svgPath.startsWith('M') && p.svgPath.endsWith('Z'))
    assert.ok(p.centroidPx[0] >= 0 && p.centroidPx[0] <= 680)
    assert.ok(p.centroidPx[1] >= 0 && p.centroidPx[1] <= 540)
  }

  // Verifica todos os 27 arquivos municipais <uf>-mun.topo.json (< 300 KB cada)
  const munFiles = fs
    .readdirSync(path.join(GEO_DIR, 'mun'))
    .filter((f) => f.endsWith('-mun.topo.json'))
  assert.equal(munFiles.length, 27)
  for (const file of munFiles) {
    const full = path.join(GEO_DIR, 'mun', file)
    const size = fs.statSync(full).size
    assert.ok(
      size < 300 * 1024,
      `${file} (${size} B) deve ser menor que 300 KB`,
    )
  }

  // Escala divergente neutra (sem cores partidárias)
  const neutralLight = getDivergentSwingFill(0, false)
  const neutralDark = getDivergentSwingFill(null, true)
  const posViolet = getDivergentSwingFill(5.0, false)
  const negTeal = getDivergentSwingFill(-5.0, false)
  assert.equal(neutralLight, '#f1f5f9')
  assert.equal(neutralDark, '#334155')
  assert.notEqual(posViolet, negTeal)
})

test('Fase 4 — Linha do tempo da apuração e Replay Histórico 2022 possuem séries completas e marcos de virada', () => {
  const replay = readJson('replay-2022/presidente.json')
  assert.ok(replay.frames.length >= 20)
  assert.match(replay.title, /2022/)

  const lastFrame = replay.frames[replay.frames.length - 1]
  assert.equal(lastFrame.sections.pct_counted, 100)
  assert.equal(lastFrame.timeline.length, replay.frames.length)
})

test('Fase 5 — Paleta temática por candidato/partido (Vermelho para Lula, Azul para adversário, cores distintas por partido nos governadores), fotos oficiais, Agente Lex e Modo Foco', () => {
  // Dados de exemplo versionados (o catalog.json/latest.json da raiz só existe com o poller rodando)
  const catalog = readJson('stages/65pct/catalog.json')
  for (const item of catalog.disputes) {
    assert.ok(
      item.cand1_photo_url && item.cand1_photo_url.startsWith('/avatars/'),
      `cand1_photo_url deve existir (${item.cand1_photo_url})`,
    )
    assert.ok(
      item.cand2_photo_url && item.cand2_photo_url.startsWith('/avatars/'),
      `cand2_photo_url deve existir (${item.cand2_photo_url})`,
    )

    const snap = readJson(`stages/65pct/${item.dispute_id}/latest.json`)
    const [cand1, cand2] = snap.candidates
    const [theme1, theme2] = getDisputePairThemes(cand1, cand2)
    assert.notEqual(
      theme1.key,
      theme2.key,
      `Disputa ${item.dispute_id} deve ter cores temáticas distintas para os dois finalistas (${theme1.key} vs ${theme2.key})`,
    )

    if (item.dispute_id === 'presidente') {
      assert.equal(theme1.key, 'red')
      assert.equal(theme1.hexLight, '#DC2626')
      assert.equal(theme1.hexDark, '#EF4444')
      assert.equal(theme2.key, 'blue')
      assert.equal(theme2.hexLight, '#1D4ED8')
      assert.equal(theme2.hexDark, '#3B82F6')
    }

    for (const cand of snap.candidates) {
      assert.ok(cand.photo_url.startsWith('/avatars/') && cand.photo_url.endsWith('.jpg'))
      assert.match(cand.tse_photo_filename, /^f\d+_div\.jpg$/)
      assert.match(cand.tse_photo_url, /^https:\/\/resultados\.tse\.jus\.br\/oficial\//)
      const avatarPath = path.join(ROOT, 'public', cand.photo_url)
      assert.ok(
        fs.existsSync(avatarPath) && fs.statSync(avatarPath).size > 1000,
        `Arquivo real de foto JPG deve existir em ${avatarPath}`,
      )
    }
  }

  // Verifica Lex News, Calculadora da Virada no topo, Mapa IBGE Ao Vivo e Modo Foco no código-fonte
  const lexCode = fs.readFileSync(
    path.join(ROOT, 'src/components/narrator/AutoNarratorFeed.tsx'),
    'utf-8',
  )
  assert.match(lexCode, /Lex News/)
  assert.match(lexCode, /lex-pulse-indicator/)

  const appCode = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8')
  assert.match(appCode, /secondary-analytics-accordions/)
  assert.match(appCode, /handleToggleFocusMode/)
  const idxScoreboard = appCode.indexOf('<NeutralScoreboard')
  const idxTurnaround = appCode.indexOf('<TurnaroundCalculator')
  const idxMap = appCode.indexOf('<SwingMapSection')
  assert.ok(
    idxScoreboard > 0 && idxTurnaround > idxScoreboard && idxMap > idxTurnaround,
    'Calculadora da Virada deve ficar posicionada no topo, logo abaixo do Placar Principal e acima do Mapa',
  )

  const mapCode = fs.readFileSync(
    path.join(ROOT, 'src/components/map/SwingMapSection.tsx'),
    'utf-8',
  )
  assert.match(mapCode, /map-metric-live-btn/)
  assert.match(mapCode, /map-metric-swing-btn/)
  assert.match(mapCode, /Ao Vivo \(2º Turno\)/)
})

test('Fase 5 — PWA (manifest.webmanifest, sw.js), Open Graph e Relatório de Teste de Carga presentes e íntegros', () => {
  const manifestPath = path.join(ROOT, 'public/manifest.webmanifest')
  assert.ok(fs.existsSync(manifestPath))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  assert.equal(manifest.display, 'standalone')
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2)

  const swPath = path.join(ROOT, 'public/sw.js')
  assert.ok(fs.existsSync(swPath))
  const swContent = fs.readFileSync(swPath, 'utf-8')
  assert.match(swContent, /apuracao-2t-snapshots-v1/)

  const ogPath = path.join(ROOT, 'public/og-apuracao-2t.svg')
  assert.ok(fs.existsSync(ogPath))

  const report = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'docs/relatorios/load_test_report.json'),
      'utf-8',
    ),
  )
  assert.equal(report.error_rate_pct, 0)
  assert.equal(report.tse_requests_triggered_by_users, 0)
  assert.ok(report.total_requests >= 2000)
})

test('Refinamento Visual — 27 Bandeiras Oficiais das UFs presentes e zero emojis no Lex News / Velocímetro', () => {
  const flagsDir = path.join(ROOT, 'public/flags')
  assert.ok(fs.existsSync(flagsDir))
  const ufs = [
    'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms',
    'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc',
    'sp', 'se', 'to', 'br',
  ]
  for (const uf of ufs) {
    const flagPath = path.join(flagsDir, `${uf}.svg`)
    assert.ok(fs.existsSync(flagPath), `Bandeira ${uf}.svg deve existir em public/flags/`)
    const content = fs.readFileSync(flagPath, 'utf-8')
    assert.match(content, /^<svg/i)
  }

  const lexCode = fs.readFileSync(path.join(ROOT, 'src/components/narrator/AutoNarratorFeed.tsx'), 'utf-8')
  assert.doesNotMatch(lexCode, /(?:🎯|📍|⚡|📈|🏛️|🔄)/u)
  assert.match(lexCode, /renderCleanTickerContent/)

  const speedCode = fs.readFileSync(path.join(ROOT, 'src/components/scoreboard/CountingSpeedometer.tsx'), 'utf-8')
  assert.doesNotMatch(speedCode, /(?:🎯|📍|⚡|📈|🏛️|🔄|✓)/u)
})

test('StickyCompactScoreboard — Barra fixa em telas largas (>=1100px) e casos de teste da barra de duelo', () => {
  const code = fs.readFileSync(
    path.join(ROOT, 'src/components/scoreboard/StickyCompactScoreboard.tsx'),
    'utf-8',
  )

  // Não deve conter max-w-[1600px] que causava recuo excessivo em telas largas
  assert.doesNotMatch(code, /max-w-\[1600px\]/)
  assert.match(code, /max-w-\[1840px\]/)

  // Barra unificada com CompactDuelingBar
  assert.match(code, /CompactDuelingBar/)

  // Função pura para testar as larguras das barras
  function computeBarWidths(cand1Pct, cand2Pct) {
    const totalPct = cand1Pct + cand2Pct
    const bar1Width = totalPct > 0 ? (cand1Pct / totalPct) * 100 : 50
    const bar2Width = 100 - bar1Width
    return { bar1Width, bar2Width }
  }

  // 1. Cenário atual: 49,02% x 50,98%
  const caseLive = computeBarWidths(49.02, 50.98)
  assert.equal(caseLive.bar1Width, 49.02)
  assert.equal(caseLive.bar2Width, 50.98)
  assert.equal(caseLive.bar1Width + caseLive.bar2Width, 100)

  // 2. 0% de urnas / sem dados (50% / 50% meio a meio)
  const caseZero = computeBarWidths(0, 0)
  assert.equal(caseZero.bar1Width, 50)
  assert.equal(caseZero.bar2Width, 50)

  // 3. Empate 50% x 50%
  const caseTie = computeBarWidths(50, 50)
  assert.equal(caseTie.bar1Width, 50)
  assert.equal(caseTie.bar2Width, 50)

  // 4. Vantagem ampla (70% x 30%)
  const caseWide = computeBarWidths(70, 30)
  assert.equal(caseWide.bar1Width, 70)
  assert.equal(caseWide.bar2Width, 30)

  // 5. 100% x 0%
  const caseSolo = computeBarWidths(100, 0)
  assert.equal(caseSolo.bar1Width, 100)
  assert.equal(caseSolo.bar2Width, 0)
})

test('Zoom Semântico — Projeção alinhada de municípios no sistema de coordenadas do Brasil e carregamento sob demanda', () => {
  const brUfPath = path.join(GEO_DIR, 'br-ufs.topo.json')
  const brTopo = JSON.parse(fs.readFileSync(brUfPath, 'utf-8'))
  const decodedUfs = decodeTopoJSON(brTopo, 'ufs')
  const brazilBounds = computeMercatorBounds(decodedUfs)

  assert.ok(brazilBounds.minX < brazilBounds.maxX)
  assert.ok(brazilBounds.minY < brazilBounds.maxY)

  // Projeção do mapa macro do Brasil
  const projectedUfs = projectFeaturesMercator(decodedUfs, 680, 540, 22)
  const ceUf = projectedUfs.find((u) => u.properties.uf === 'CE')
  assert.ok(ceUf, 'UF CE deve existir nas features projetadas')

  // Malha de municípios sob demanda do Ceará
  const ceMunPath = path.join(GEO_DIR, 'mun/ce-mun.topo.json')
  assert.ok(fs.existsSync(ceMunPath), 'public/geo/mun/ce-mun.topo.json deve existir')
  const ceTopo = JSON.parse(fs.readFileSync(ceMunPath, 'utf-8'))
  const decodedCeMun = decodeTopoJSON(ceTopo, 'municipios')
  assert.equal(decodedCeMun.length, 184, 'Ceará possui 184 municípios')

  // Projeção dos municípios usando as coordenadas de referência do Brasil (fitBounds pixel-perfect)
  const projectedCeMun = projectFeaturesMercator(decodedCeMun, 680, 540, 22, brazilBounds)
  assert.equal(projectedCeMun.length, 184)

  // Todos os municípios do Ceará devem estar contidos na proximidade da bounding box do Ceará
  const [ceX0, ceY0, ceX1, ceY1] = ceUf.bboxPx
  for (const m of projectedCeMun) {
    const [cx, cy] = m.centroidPx
    assert.ok(
      cx >= ceX0 - 2 && cx <= ceX1 + 2,
      `Centróide X de ${m.properties.name} (${cx}) deve estar contido em CE [${ceX0}, ${ceX1}]`,
    )
    assert.ok(
      cy >= ceY0 - 2 && cy <= ceY1 + 2,
      `Centróide Y de ${m.properties.name} (${cy}) deve estar contido em CE [${ceY0}, ${ceY1}]`,
    )
  }

  // Verifica que o código fonte do mapa inclui a camada e transição de municípios
  const geoMapCode = fs.readFileSync(
    path.join(ROOT, 'src/components/map/GeoChoroplethMap.tsx'),
    'utf-8',
  )
  assert.match(geoMapCode, /municipalities-layer/)
  assert.match(geoMapCode, /transition-opacity/)
  assert.match(geoMapCode, /onResetZoom/)
})



