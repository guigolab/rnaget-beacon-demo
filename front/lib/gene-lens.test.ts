import {
  featureDisplayLabel,
  featureSymbol,
  matrixViewHref,
  resolveSelectedFeature} from './gene-lens'
import type { Feature } from '@/lib/beacon/types'

const f1: Feature = { id: 'a', matrixIds: ['m1', 'm2'] }
const f2: Feature = { id: 'b', matrixIds: ['m1'] }

console.assert(resolveSelectedFeature([f1, f2], null) === null)
console.assert(resolveSelectedFeature([f1], null)?.id === 'a')
console.assert(resolveSelectedFeature([f1, f2], 'b')?.id === 'b')

const accessionFirst: Feature = {
  id: 'feature-ENSG00000198886.2',
  aliases: ['ENSG00000198886', 'MT-ND4'],
    featureIdentifier: { id: 'ENSG00000198886.2', resource: 'gencode' }}
console.assert(featureSymbol(accessionFirst) === 'MT-ND4')
console.assert(featureDisplayLabel(accessionFirst) === 'MT-ND4')
console.assert(matrixViewHref('GTEx-v8-Liver', accessionFirst).includes('genes=MT-ND4'))

const symbolFirst: Feature = {
  id: 'feature-tp53',
  aliases: ['TP53'], featureIdentifier: { id: 'ENSG00000141510' }}
console.assert(featureDisplayLabel(symbolFirst) === 'TP53')

console.log('gene-lens.test.ts: ok')
