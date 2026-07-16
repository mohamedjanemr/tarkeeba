import { describe, expect, it } from 'vitest';
import { buildRequirementsScopeContract } from '../requirements-scope';

describe('buildRequirementsScopeContract', () => {
  const createdAt = new Date('2026-07-16T12:00:00.000Z');

  it('builds a conservative scope contract from a task description', () => {
    expect(
      buildRequirementsScopeContract(
        '  Add Azure DevOps integration parallel to GitHub and GitLab  ',
        ' feature ',
        ['backend', 'frontend'],
        createdAt
      )
    ).toEqual({
      scope_contract_version: 1,
      task_description: 'Add Azure DevOps integration parallel to GitHub and GitLab',
      workflow_type: 'feature',
      services_involved: ['backend', 'frontend'],
      must_have: ['Add Azure DevOps integration parallel to GitHub and GitLab'],
      required_parity: [],
      deferred: [],
      reuse_existing: [],
      non_goals: ['Capabilities not explicitly required by the task description'],
      acceptance_criteria: [],
      constraints: [],
      created_at: '2026-07-16T12:00:00.000Z'
    });
  });

  it('uses empty defaults when description and services are omitted', () => {
    const contract = buildRequirementsScopeContract('   ', 'feature', undefined, createdAt);

    expect(contract.task_description).toBe('');
    expect(contract.services_involved).toEqual([]);
    expect(contract.must_have).toEqual([]);
  });

  it('does not retain a mutable reference to the provided services', () => {
    const services = ['backend'];
    const contract = buildRequirementsScopeContract('Add integration', 'feature', services, createdAt);

    services.push('frontend');

    expect(contract.services_involved).toEqual(['backend']);
  });

  it('uses explicit structured scope when provided', () => {
    const contract = buildRequirementsScopeContract(
      'Add provider',
      'feature',
      [],
      createdAt,
      {
        mustHave: [' Connect repositories '],
        requiredParity: ['Pull request listing'],
        deferred: ['Pipeline management'],
        reuseExisting: ['Git provider settings form'],
        nonGoals: ['Work item boards'],
        acceptanceCriteria: ['Repository connection succeeds']
      }
    );

    expect(contract.must_have).toEqual(['Connect repositories']);
    expect(contract.required_parity).toEqual(['Pull request listing']);
    expect(contract.deferred).toEqual(['Pipeline management']);
    expect(contract.reuse_existing).toEqual(['Git provider settings form']);
    expect(contract.non_goals).toEqual(['Work item boards']);
    expect(contract.acceptance_criteria).toEqual(['Repository connection succeeds']);
  });
});
