export interface RequirementsScopeContract {
  scope_contract_version: 1;
  task_description: string;
  workflow_type: string;
  services_involved: string[];
  must_have: string[];
  required_parity: string[];
  deferred: string[];
  reuse_existing: string[];
  non_goals: string[];
  acceptance_criteria: string[];
  constraints: string[];
  created_at: string;
}

export interface RequirementsScopeInput {
  mustHave?: readonly string[];
  requiredParity?: readonly string[];
  deferred?: readonly string[];
  reuseExisting?: readonly string[];
  nonGoals?: readonly string[];
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
}

function cleanList(values: readonly string[] | undefined): string[] {
  return (values || []).map(value => value.trim()).filter(Boolean);
}

/**
 * Build the conservative requirements contract used when creating a task
 * without an interactive requirements-gathering step.
 */
export function buildRequirementsScopeContract(
  taskDescription: string,
  workflowType: string,
  servicesInvolved: readonly string[] = [],
  createdAt: Date = new Date(),
  scope: RequirementsScopeInput = {}
): RequirementsScopeContract {
  const normalizedDescription = taskDescription.trim();
  const mustHave = cleanList(scope.mustHave);
  const nonGoals = cleanList(scope.nonGoals);

  return {
    scope_contract_version: 1,
    task_description: normalizedDescription,
    workflow_type: workflowType.trim(),
    services_involved: [...servicesInvolved],
    must_have: mustHave.length > 0
      ? mustHave
      : normalizedDescription
        ? [normalizedDescription]
        : [],
    required_parity: cleanList(scope.requiredParity),
    deferred: cleanList(scope.deferred),
    reuse_existing: cleanList(scope.reuseExisting),
    non_goals: nonGoals.length > 0
      ? nonGoals
      : ['Capabilities not explicitly required by the task description'],
    acceptance_criteria: cleanList(scope.acceptanceCriteria),
    constraints: cleanList(scope.constraints),
    created_at: createdAt.toISOString()
  };
}
