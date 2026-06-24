import { useEffect, useRef, useState } from 'react';
import type {
  ChecklistItem,
  MergeOptionId,
  PullRequestMergeability,
} from '@shared/types';
import { ErrorBanner } from './ErrorBanner';

// Shared modal shell: dim backdrop, centered card, Esc to cancel, focus trap to
// the card. Used by the merge + edit + approve-checklist dialogs.
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    cardRef.current?.focus();
  }, []);
  return (
    <div
      className="pr-dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pr-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={cardRef}
      >
        <div className="pr-dialog-head">{title}</div>
        {children}
      </div>
    </div>
  );
}

const MERGE_LABEL: Record<MergeOptionId, string> = {
  FAST_FORWARD_MERGE: 'Fast-forward',
  SQUASH_MERGE: 'Squash',
  THREE_WAY_MERGE: 'Three-way (merge commit)',
};

const MERGE_DESC: Record<MergeOptionId, string> = {
  FAST_FORWARD_MERGE:
    'Move the destination branch pointer forward. No merge commit. Linear history.',
  SQUASH_MERGE:
    'Combine all PR commits into a single commit on the destination branch.',
  THREE_WAY_MERGE:
    'Create a merge commit joining the source and destination branches.',
};

export function MergeDialog({
  mergeability,
  busy,
  error,
  onCancel,
  onMerge,
}: {
  mergeability: PullRequestMergeability;
  busy: boolean;
  // A failed merge attempt, shown inline so the dialog stays open for a retry.
  error?: unknown;
  onCancel: () => void;
  onMerge: (strategy: MergeOptionId, commitMessage: string) => void;
}): JSX.Element {
  const options = mergeability.mergeOptions;
  const [strategy, setStrategy] = useState<MergeOptionId>(
    options[0] ?? 'THREE_WAY_MERGE',
  );
  const [message, setMessage] = useState('');
  const needsMessage = strategy !== 'FAST_FORWARD_MERGE';

  return (
    <Modal title="Merge pull request" onClose={onCancel}>
      <div className="pr-dialog-body">
        <div className="merge-strategies">
          {options.map((opt) => (
            <label key={opt} className="merge-strategy">
              <input
                type="radio"
                name="merge-strategy"
                checked={strategy === opt}
                onChange={() => setStrategy(opt)}
              />
              <span className="merge-strategy-text">
                <span className="merge-strategy-name">{MERGE_LABEL[opt]}</span>
                <span className="merge-strategy-desc hint">
                  {MERGE_DESC[opt]}
                </span>
              </span>
            </label>
          ))}
        </div>
        {needsMessage && (
          <label className="pr-dialog-field">
            Commit message <span className="hint">(optional)</span>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Leave blank to use the default merge message"
              spellCheck={false}
            />
          </label>
        )}
      </div>
      {error != null && <ErrorBanner title="Merge failed." error={error} />}
      <div className="pr-dialog-actions">
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || options.length === 0}
          onClick={() => onMerge(strategy, message)}
        >
          {busy ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </Modal>
  );
}

// Shown when approving a PR in a repo that has an approval checklist. The gate
// is advisory (warn-but-allow): unchecked required items are flagged but never
// block Approve. The set of checked items is handed back so the caller can
// record the acknowledgement in the PR description.
export function ChecklistApproveModal({
  items,
  busy,
  error,
  onCancel,
  onApprove,
}: {
  items: ChecklistItem[];
  busy: boolean;
  error?: unknown;
  onCancel: () => void;
  onApprove: (checked: Record<string, boolean>) => void;
}): JSX.Element {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const toggle = (id: string): void =>
    setChecked((c) => ({ ...c, [id]: !c[id] }));
  const uncheckedRequired = items.filter((i) => i.required && !checked[i.id]);

  return (
    <Modal title="Approve pull request" onClose={onCancel}>
      <div className="pr-dialog-body">
        <p className="hint">
          Confirm this repository&rsquo;s review checklist. Your checked items
          are recorded in the PR description. Approving is never blocked —
          unchecked items are just a reminder.
        </p>
        <ul className="approve-checklist">
          {items.map((it) => (
            <li
              key={it.id}
              className={`approve-checklist-item${it.required ? ' is-required' : ''}`}
            >
              <label>
                <input
                  type="checkbox"
                  checked={!!checked[it.id]}
                  onChange={() => toggle(it.id)}
                />
                <span className="approve-checklist-text">{it.text}</span>
                {it.required && (
                  <span className="approve-required-tag">required</span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {uncheckedRequired.length > 0 && (
          <div className="approve-checklist-warn">
            {uncheckedRequired.length} required item
            {uncheckedRequired.length === 1 ? '' : 's'} still unchecked — you can
            still approve.
          </div>
        )}
      </div>
      {error != null && <ErrorBanner title="Approve failed." error={error} />}
      <div className="pr-dialog-actions">
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => onApprove(checked)}
        >
          {busy ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </Modal>
  );
}

export function EditPRDialog({
  initialTitle,
  initialDescription,
  busy,
  error,
  onCancel,
  onSave,
}: {
  initialTitle: string;
  initialDescription: string;
  busy: boolean;
  // A failed save, shown inline so the dialog stays open for a retry.
  error?: unknown;
  onCancel: () => void;
  onSave: (title: string, description: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const titleEmpty = title.trim().length === 0;
  const unchanged =
    title === initialTitle && description === initialDescription;

  return (
    <Modal title="Edit pull request" onClose={onCancel}>
      <div className="pr-dialog-body">
        <label className="pr-dialog-field">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="pr-dialog-field">
          Description <span className="hint">(Markdown)</span>
          <textarea
            rows={8}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            spellCheck={false}
          />
        </label>
      </div>
      {error != null && <ErrorBanner title="Save failed." error={error} />}
      <div className="pr-dialog-actions">
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || titleEmpty || unchanged}
          onClick={() => onSave(title.trim(), description)}
          title={
            titleEmpty
              ? 'Title is required'
              : unchanged
                ? 'No changes to save'
                : undefined
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
