// Simulação (estágios 0%..100%) só existe em builds de desenvolvimento/homologação.
// Build de produção: NÃO defina VITE_ENABLE_SIMULATION (ou defina como "false").
export const SIMULATION_ENABLED = import.meta.env.VITE_ENABLE_SIMULATION === 'true'
