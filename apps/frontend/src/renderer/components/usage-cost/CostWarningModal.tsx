/**
 * Modal shown when a task's predicted cost exceeds the configured spend threshold and
 * the agent spawn is paused pending user confirmation (see AgentManager.checkCostWarningGate).
 * Mounted once globally (in App.tsx) and subscribes directly to the
 * onCostWarningRequired IPC event; resolves the pending gate via confirmCostWarning.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { formatCurrency } from './CostSummaryCards';
import type { CostWarningRequiredPayload } from '../../../preload/api/modules/usage-cost-api';
import { debugError } from '../../../shared/utils/debug-logger';

export function CostWarningModal() {
  const { t } = useTranslation('usageCost');
  const [pendingWarning, setPendingWarning] = useState<CostWarningRequiredPayload | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const cleanup = window.electronAPI.onCostWarningRequired((payload) => {
      setPendingWarning(payload);
    });
    return cleanup;
  }, []);

  const resolveWarning = async (approved: boolean) => {
    if (!pendingWarning || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await window.electronAPI.confirmCostWarning(pendingWarning.taskId, approved);
    } catch (err) {
      debugError('[CostWarningModal] Failed to confirm cost warning:', err);
    } finally {
      setIsSubmitting(false);
      setPendingWarning(null);
    }
  };

  return (
    <Dialog
      open={!!pendingWarning}
      onOpenChange={(open) => {
        if (!open) resolveWarning(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            {t('warningModal.title')}
          </DialogTitle>
          <DialogDescription>{t('warningModal.description')}</DialogDescription>
        </DialogHeader>

        {pendingWarning && (
          <div className="py-2 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
              <span className="text-sm text-muted-foreground">{t('warningModal.predictedCostLabel')}</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(pendingWarning.predictedCostUsd)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
              <span className="text-sm text-muted-foreground">{t('warningModal.thresholdLabel')}</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(pendingWarning.threshold)}
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => resolveWarning(false)} disabled={isSubmitting}>
            {t('warningModal.cancel')}
          </Button>
          <Button variant="default" onClick={() => resolveWarning(true)} disabled={isSubmitting}>
            {t('warningModal.proceed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
