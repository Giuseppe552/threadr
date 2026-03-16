export { createMass, combine, fuseAll, FIELD_RELIABILITY } from './dempsterShafer.js'
export type { MassFunction, DSResult } from './dempsterShafer.js'

export { analyzeSpectrum } from './spectral.js'
export type { AdjacencyInput, SpectralResult } from './spectral.js'

export { predictLinks } from './linkPrediction.js'
export type { PredictedLink, LinkPredictionResult } from './linkPrediction.js'

export { computeExposure } from './exposure.js'
export type { ExposureScore } from './exposure.js'

export { graphDistance } from './wasserstein.js'
export type { TransportPlan } from './wasserstein.js'
