/**
 * Spend-warning threshold section for the Usage & Cost dashboard. Lets the user toggle
 * cost warnings on/off and set the USD threshold above which a task's predicted cost
 * triggers the CostWarningModal confirmation gate (see AgentManager.checkCostWarningGate).
 *
 * Bound directly to the settings store (like the uiScale control): reads from
 * useSettingsStore and persists via the store's saveSettings() action immediately on change.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import { SPEND_WARNING_THRESHOLD_DEFAULT } from '../../../shared/constants';
import { debugError } from '../../../shared/utils/debug-logger';

export function SpendThresholdSettings() {
  const { t } = useTranslation('usageCost');
  const costWarningEnabled = useSettingsStore((state) => state.settings.costWarningEnabled ?? true);
  const spendWarningThresholdUsd = useSettingsStore(
    (state) => state.settings.spendWarningThresholdUsd ?? SPEND_WARNING_THRESHOLD_DEFAULT
  );

  // Local text state so the input can hold intermediate/invalid text while typing
  const [thresholdInput, setThresholdInput] = useState(String(spendWarningThresholdUsd));
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  const handleEnabledChange = async (enabled: boolean) => {
    try {
      await saveSettings({ costWarningEnabled: enabled });
    } catch (err) {
      debugError('[SpendThresholdSettings] Failed to save costWarningEnabled:', err);
    }
  };

  const handleThresholdChange = (value: string) => {
    setThresholdInput(value);

    const parsed = Number(value);
    if (value.trim() === '' || Number.isNaN(parsed) || parsed <= 0) {
      setThresholdError(t('thresholdSettings.invalidThreshold'));
      return;
    }
    setThresholdError(null);
  };

  const commitThreshold = async () => {
    const parsed = Number(thresholdInput);
    if (thresholdInput.trim() === '' || Number.isNaN(parsed) || parsed <= 0) {
      // Revert to last known-good value on blur if invalid
      setThresholdInput(String(spendWarningThresholdUsd));
      setThresholdError(null);
      return;
    }

    try {
      await saveSettings({ spendWarningThresholdUsd: parsed });
    } catch (err) {
      debugError('[SpendThresholdSettings] Failed to save spendWarningThresholdUsd:', err);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          {t('thresholdSettings.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('thresholdSettings.description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="cost-warning-enabled" className="text-sm font-medium text-foreground">
            {t('thresholdSettings.enableLabel')}
          </Label>
          <Switch
            id="cost-warning-enabled"
            checked={costWarningEnabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="spend-warning-threshold" className="text-sm font-medium text-foreground">
            {t('thresholdSettings.thresholdLabel')}
          </Label>
          <Input
            id="spend-warning-threshold"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            className="max-w-xs"
            placeholder={t('thresholdSettings.thresholdPlaceholder')}
            value={thresholdInput}
            disabled={!costWarningEnabled}
            onChange={(e) => handleThresholdChange(e.target.value)}
            onBlur={commitThreshold}
          />
          {thresholdError && <p className="text-xs text-destructive">{thresholdError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
