import { useEffect, useMemo, useState } from 'react';
import { Bot, Check } from 'lucide-react';
import type { CodexModelInfo, CodexReasoningEffort } from '../../shared/types';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface CodexInsightsModelSelectorProps {
  profileId?: string;
  model: string;
  reasoningEffort: CodexReasoningEffort;
  disabled?: boolean;
  onChange: (model: string, reasoningEffort: CodexReasoningEffort) => void;
}

const EFFORTS: CodexReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

export function CodexInsightsModelSelector({
  profileId,
  model,
  reasoningEffort,
  disabled,
  onChange,
}: CodexInsightsModelSelectorProps) {
  const [models, setModels] = useState<CodexModelInfo[]>([]);

  useEffect(() => {
    let disposed = false;
    void window.electronAPI.listCodexModels(profileId).then((result) => {
      if (!disposed && result.success && result.data) setModels(result.data);
    });
    return () => { disposed = true; };
  }, [profileId]);

  const selectedModel = useMemo(
    () => models.find((candidate) => candidate.id === model),
    [model, models]
  );
  const supportedEfforts = selectedModel?.supportedReasoningEfforts.length
    ? selectedModel.supportedReasoningEfforts
    : EFFORTS;

  const selectModel = (nextModel: CodexModelInfo) => {
    const efforts = nextModel.supportedReasoningEfforts;
    const nextEffort = efforts.length === 0 || efforts.includes(reasoningEffort)
      ? reasoningEffort
      : nextModel.defaultReasoningEffort || efforts[0];
    onChange(nextModel.id, nextEffort);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 px-2"
          disabled={disabled}
          title={`Codex model: ${selectedModel?.displayName || model} (${reasoningEffort})`}
        >
          <Bot className="h-4 w-4" />
          <span className="hidden max-w-44 truncate text-xs text-muted-foreground sm:inline">
            {selectedModel?.displayName || model} · {reasoningEffort}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Codex Model</DropdownMenuLabel>
        {models.map((candidate) => (
          <DropdownMenuItem
            key={candidate.id}
            onClick={() => selectModel(candidate)}
            className="cursor-pointer"
          >
            <span className="min-w-0 flex-1 truncate">{candidate.displayName}</span>
            {candidate.id === model && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {models.length === 0 && (
          <DropdownMenuItem disabled>{model}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Reasoning Effort</DropdownMenuLabel>
        {supportedEfforts.map((effort) => (
          <DropdownMenuItem
            key={effort}
            onClick={() => onChange(model, effort)}
            className="cursor-pointer capitalize"
          >
            <span className="flex-1">{effort}</span>
            {effort === reasoningEffort && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
