import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Pencil, Trash2, Save, X, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { formatDate } from '../context/utils';
import { deleteEntry, updateEntry } from '../../stores/memory-store';
import type { MemoryEntity, MemoryEpisode, MemoryKind } from '../../../shared/types';

interface MemoryEntryDetailProps {
  projectId: string;
  entry: MemoryEpisode | MemoryEntity | null;
  onClose: () => void;
}

// Discriminates a knowledge-graph entity from an episodic memory entry.
function isEntity(entry: MemoryEpisode | MemoryEntity): entry is MemoryEntity {
  return 'summary' in entry;
}

/**
 * Dialog for viewing a single memory entry with Edit (update-memory) and
 * Prune/Delete (delete-memory, guarded by an inline confirmation) actions.
 */
export function MemoryEntryDetail({ projectId, entry, onClose }: MemoryEntryDetailProps) {
  const { t } = useTranslation('memory');
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

  // Reset local edit state whenever a new entry is opened.
  useEffect(() => {
    if (!entry) return;
    setIsEditing(false);
    setConfirmingDelete(false);
    setIsSaving(false);
    if (isEntity(entry)) {
      setName(entry.name);
      setBody(entry.summary);
    } else {
      setName('');
      setBody(entry.content);
    }
  }, [entry]);

  if (!entry) return null;

  const entity = isEntity(entry);
  const kind: MemoryKind = entity ? 'entity' : 'episodic';
  const typeLabel = entity ? entry.type : entry.type;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (entity) {
        await updateEntry(projectId, entry.id, kind, { name, summary: body });
      } else {
        await updateEntry(projectId, entry.id, kind, { content: body });
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsSaving(true);
    try {
      await deleteEntry(projectId, entry.id, kind);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entity ? entry.name : t('detail.episodeTitle')}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3">
            <Badge variant="outline" className="capitalize">
              {typeLabel.replace(/_/g, ' ')}
            </Badge>
            <span className="flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" />
              {formatDate(entry.timestamp)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-2">
          <div className="space-y-4 py-2">
            {entity && isEditing && (
              <div className="space-y-1.5">
                <Label
                  htmlFor="memory-entry-name"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {t('detail.name')}
                </Label>
                <Input
                  id="memory-entry-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="memory-entry-body"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {entity ? t('detail.summary') : t('detail.content')}
              </Label>
              {isEditing ? (
                <Textarea
                  id="memory-entry-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs text-foreground">
                  {body || t('detail.empty')}
                </pre>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="items-center">
          {confirmingDelete ? (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {t('detail.confirmDelete')}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isSaving}
                  onClick={handleDelete}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {t('actions.delete')}
                </Button>
              </div>
            </div>
          ) : isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={isSaving}
                onClick={() => setIsEditing(false)}
              >
                <X className="mr-1 h-4 w-4" />
                {t('actions.cancel')}
              </Button>
              <Button size="sm" disabled={isSaving} onClick={handleSave}>
                <Save className="mr-1 h-4 w-4" />
                {t('actions.save')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isSaving}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t('actions.prune')}
              </Button>
              <Button size="sm" disabled={isSaving} onClick={() => setIsEditing(true)}>
                <Pencil className="mr-1 h-4 w-4" />
                {t('actions.edit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
