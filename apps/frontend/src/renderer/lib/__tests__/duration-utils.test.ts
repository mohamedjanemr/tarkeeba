/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for duration-utils
 * Tests phase/total duration calculation and compact duration formatting
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TaskLogs, TaskPhaseLog } from '@shared/types/task';
import { calculatePhaseDurations, calculateTotalDuration, formatDuration } from '../duration-utils';

function makePhase(overrides: Partial<TaskPhaseLog>): TaskPhaseLog {
  return {
    phase: 'planning',
    status: 'pending',
    started_at: null,
    completed_at: null,
    entries: [],
    ...overrides,
  };
}

function makeLogs(overrides: Partial<TaskLogs['phases']>): TaskLogs {
  return {
    spec_id: '001-test',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    phases: {
      planning: makePhase({ phase: 'planning' }),
      coding: makePhase({ phase: 'coding' }),
      validation: makePhase({ phase: 'validation' }),
      ...overrides,
    },
  };
}

describe('duration-utils', () => {
  describe('calculatePhaseDurations', () => {
    it('returns an empty object for null logs', () => {
      expect(calculatePhaseDurations(null)).toEqual({});
    });

    it('returns only the planning duration when only planning has started/completed', () => {
      const logs = makeLogs({
        planning: makePhase({
          phase: 'planning',
          status: 'completed',
          started_at: '2024-01-01T00:00:00.000Z',
          completed_at: '2024-01-01T00:10:00.000Z',
        }),
      });

      const durations = calculatePhaseDurations(logs);

      expect(durations.planning).toBe(10 * 60 * 1000);
      expect(durations.coding).toBeUndefined();
      expect(durations.validation).toBeUndefined();
      expect(Object.keys(durations)).toEqual(['planning']);
    });

    it('computes duration against a fixed "now" for a phase still in progress', () => {
      const fixedNow = new Date('2024-01-01T00:30:00.000Z').getTime();
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      try {
        const logs = makeLogs({
          coding: makePhase({
            phase: 'coding',
            status: 'active',
            started_at: '2024-01-01T00:00:00.000Z',
            completed_at: null,
          }),
        });

        const durations = calculatePhaseDurations(logs);

        expect(durations.coding).toBe(30 * 60 * 1000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('computes each completed phase duration independently', () => {
      const logs = makeLogs({
        planning: makePhase({
          phase: 'planning',
          status: 'completed',
          started_at: '2024-01-01T00:00:00.000Z',
          completed_at: '2024-01-01T00:05:00.000Z',
        }),
        coding: makePhase({
          phase: 'coding',
          status: 'completed',
          started_at: '2024-01-01T00:10:00.000Z',
          completed_at: '2024-01-01T00:40:00.000Z',
        }),
        validation: makePhase({
          phase: 'validation',
          status: 'completed',
          started_at: '2024-01-01T00:45:00.000Z',
          completed_at: '2024-01-01T00:50:00.000Z',
        }),
      });

      const durations = calculatePhaseDurations(logs);

      expect(durations.planning).toBe(5 * 60 * 1000);
      expect(durations.coding).toBe(30 * 60 * 1000);
      expect(durations.validation).toBe(5 * 60 * 1000);
    });
  });

  describe('calculateTotalDuration', () => {
    it('returns null for null logs', () => {
      expect(calculateTotalDuration(null)).toBeNull();
    });

    it('returns null when no phase has started', () => {
      const logs = makeLogs({});
      expect(calculateTotalDuration(logs)).toBeNull();
    });

    it('spans from the first phase start to the last phase end, not the sum of per-phase durations', () => {
      // planning: 00:00 - 00:05 (5m)
      // coding:   00:10 - 00:40 (30m), with a 5m gap after planning
      // validation: 00:45 - 00:50 (5m), with a 5m gap after coding
      // Sum of phase durations = 5 + 30 + 5 = 40m
      // Total span = 00:00 -> 00:50 = 50m (includes the gaps)
      const logs = makeLogs({
        planning: makePhase({
          phase: 'planning',
          status: 'completed',
          started_at: '2024-01-01T00:00:00.000Z',
          completed_at: '2024-01-01T00:05:00.000Z',
        }),
        coding: makePhase({
          phase: 'coding',
          status: 'completed',
          started_at: '2024-01-01T00:10:00.000Z',
          completed_at: '2024-01-01T00:40:00.000Z',
        }),
        validation: makePhase({
          phase: 'validation',
          status: 'completed',
          started_at: '2024-01-01T00:45:00.000Z',
          completed_at: '2024-01-01T00:50:00.000Z',
        }),
      });

      const phaseDurations = calculatePhaseDurations(logs);
      const sumOfPhaseDurations = Object.values(phaseDurations).reduce((sum, d) => sum + (d ?? 0), 0);
      const total = calculateTotalDuration(logs);

      expect(total).toBe(50 * 60 * 1000);
      expect(sumOfPhaseDurations).toBe(40 * 60 * 1000);
      expect(total).not.toBe(sumOfPhaseDurations);
    });

    it('uses a fixed "now" as the end time when a phase is still in progress', () => {
      const fixedNow = new Date('2024-01-01T01:00:00.000Z').getTime();
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      try {
        const logs = makeLogs({
          planning: makePhase({
            phase: 'planning',
            status: 'completed',
            started_at: '2024-01-01T00:00:00.000Z',
            completed_at: '2024-01-01T00:05:00.000Z',
          }),
          coding: makePhase({
            phase: 'coding',
            status: 'active',
            started_at: '2024-01-01T00:10:00.000Z',
            completed_at: null,
          }),
        });

        const total = calculateTotalDuration(logs);

        expect(total).toBe(60 * 60 * 1000);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('formatDuration', () => {
    it('formats sub-minute durations as "< 1m"', () => {
      expect(formatDuration(0)).toBe('< 1m');
      expect(formatDuration(30 * 1000)).toBe('< 1m');
      expect(formatDuration(59 * 1000)).toBe('< 1m');
    });

    it('formats durations of several minutes', () => {
      expect(formatDuration(60 * 1000)).toBe('1m');
      expect(formatDuration(12 * 60 * 1000)).toBe('12m');
      expect(formatDuration(59 * 60 * 1000)).toBe('59m');
    });

    it('formats durations of hours and minutes', () => {
      expect(formatDuration(60 * 60 * 1000)).toBe('1h');
      expect(formatDuration(65 * 60 * 1000)).toBe('1h 5m');
      expect(formatDuration(23 * 60 * 60 * 1000 + 59 * 60 * 1000)).toBe('23h 59m');
    });

    it('formats durations over 24h as days and hours', () => {
      expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1d');
      expect(formatDuration(24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)).toBe('1d 3h');
      expect(formatDuration(2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000)).toBe('2d 5h');
    });
  });
});
