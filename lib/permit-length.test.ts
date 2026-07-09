import { describe, expect, it } from 'vitest'
import {
  effectiveEnvelopeLengthThreshold,
  needsLengthPermit,
} from './permit-length'

describe('needsLengthPermit', () => {
  it('trailer=53, envelope=74 should NOT flag for length permit', () => {
    expect(needsLengthPermit(74, 53)).toBe(false)
  })

  it('envelope=84.5 at boundary does not flag', () => {
    expect(needsLengthPermit(84.5, 53)).toBe(false)
  })

  it('envelope=84.51 just above boundary flags', () => {
    expect(needsLengthPermit(84.51, 53)).toBe(true)
  })

  it('flags when envelope exceeds 84.5 ft', () => {
    expect(needsLengthPermit(90, 53)).toBe(true)
  })

  it('treats null, undefined, and omitted trailerLengthFt as safe-harbor eligible', () => {
    expect(needsLengthPermit(74, null)).toBe(false)
    expect(needsLengthPermit(74, undefined)).toBe(false)
    expect(needsLengthPermit(74)).toBe(false)
    expect(needsLengthPermit(90, null)).toBe(true)
    expect(needsLengthPermit(90, undefined)).toBe(true)
    expect(needsLengthPermit(90)).toBe(true)
  })

  it('trailer over 53 alone does not flag when envelope is legal', () => {
    expect(needsLengthPermit(74, 55)).toBe(false)
  })

  it('treats DB trailer threshold (53) as envelope default 84.5', () => {
    expect(effectiveEnvelopeLengthThreshold(53)).toBe(84.5)
    expect(needsLengthPermit(74, 53, 53)).toBe(false)
    expect(needsLengthPermit(90, 53, 53)).toBe(true)
  })

  it('TX raw threshold 59 with trailer=53 envelope=74 does not flag', () => {
    expect(effectiveEnvelopeLengthThreshold(59)).toBe(84.5)
    expect(needsLengthPermit(74, 53, 59)).toBe(false)
  })

  it('honors state envelope threshold only when above 84.5', () => {
    expect(effectiveEnvelopeLengthThreshold(75)).toBe(84.5)
    expect(effectiveEnvelopeLengthThreshold(90)).toBe(90)
    expect(needsLengthPermit(95, 53, 90)).toBe(true)
    expect(needsLengthPermit(85, 53, 90)).toBe(false)
  })
})