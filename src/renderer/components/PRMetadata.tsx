import { useState } from 'react';
import type {
  PRDifferences,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestTarget,
} from '@shared/types';
import { Markdown } from './Markdown';

interface Props {
  detail: PullRequestDetail;
  differences: PRDifferences | null;
  mergeability: PullRequestMergeability | null;
  approvalCount: number;
  fileCount: number;
  selfApproved: boolean;
}

export function PRMetadata({
  detail,
  differences,
  mergeability,
  approvalCount,
  fileCount,
  selfApproved,
}: Props): JSX.Element {
  const [descOpen, setDescOpen] = useState(false);
  const target = pickTarget(detail.targets, differences);

  const source = stripRefs(target?.sourceReference ?? detail.targets[0]?.sourceReference ?? '');
  const dest = stripRefs(
    target?.destinationReference ?? detail.targets[0]?.destinationReference ?? '',
  );

  return (
    <div className="pr-meta">
      <div className="pr-meta-row">
        <span className="pr-meta-label">Branches</span>
        <code className="branch source" title={target?.sourceReference}>
          {source || '?'}
        </code>
        <span className="branch-arrow">→</span>
        <code className="branch dest" title={target?.destinationReference}>
          {dest || '?'}
        </code>
        {target?.sourceCommitId && (
          <span className="commit-pair">
            <code title="source commit">
              {target.sourceCommitId.slice(0, 7)}
            </code>
            <span className="branch-arrow">→</span>
            <code title="merge base / destination">
              {(target.mergeBase ?? target.destinationCommitId ?? '').slice(0, 7) ||
                '?'}
            </code>
          </span>
        )}
      </div>

      <div className="pr-meta-row">
        <span className="pr-meta-label">Status</span>
        <span className={`badge ${detail.status}`}>{detail.status}</span>
        {mergeability && <MergeabilityBadge m={mergeability} />}
        <span className={`badge ${detail.approvalState}`}>
          {detail.approvalState.replace('_', ' ')}
        </span>
        <span className="hint">
          {approvalCount} approval{approvalCount === 1 ? '' : 's'}
          {selfApproved ? ' (you ✓)' : ''}
        </span>
        <span className="hint">·</span>
        <span className="hint">
          {fileCount} file{fileCount === 1 ? '' : 's'} changed
        </span>
      </div>

      <div className="pr-meta-row">
        <span className="pr-meta-label">Author</span>
        <code className="who">{shortArn(detail.authorArn)}</code>
        <span className="hint">opened</span>
        <span className="hint" title={detail.createdAt}>
          {fmtRel(detail.createdAt)}
        </span>
        <span className="hint">· updated</span>
        <span className="hint" title={detail.lastActivityAt}>
          {fmtRel(detail.lastActivityAt)}
        </span>
      </div>

      {detail.description && (
        <div className="pr-meta-row">
          <span className="pr-meta-label">Description</span>
          <button
            className="link"
            onClick={() => setDescOpen((v) => !v)}
          >
            {descOpen ? 'Hide' : 'Show'}
          </button>
          {descOpen && (
            <div className="pr-description">
              <Markdown source={detail.description} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MergeabilityBadge({
  m,
}: {
  m: PullRequestMergeability;
}): JSX.Element {
  switch (m.state) {
    case 'already_merged': {
      const title = m.mergedBy
        ? `Merged by ${shortArn(m.mergedBy)}` +
          (m.mergeCommitId ? ` (${m.mergeCommitId.slice(0, 7)})` : '')
        : 'Merged';
      return (
        <span className="badge MERGED" title={title}>
          MERGED
        </span>
      );
    }
    case 'mergeable': {
      const title = `Mergeable via: ${m.mergeOptions.join(', ') || '?'}`;
      return (
        <span className="badge APPROVED" title={title}>
          MERGEABLE
        </span>
      );
    }
    case 'has_conflicts': {
      const count = m.conflictCount ?? 0;
      const filesPart =
        m.conflictFiles && m.conflictFiles.length > 0
          ? `\nConflicts in:\n  ${m.conflictFiles.join('\n  ')}`
          : '';
      const title = count > 0
        ? `${count} conflicted file${count === 1 ? '' : 's'}${filesPart}`
        : (m.reason ?? 'Manual merge required');
      const label = count > 0 ? `CONFLICTS (${count})` : 'CONFLICTS';
      return (
        <span className="badge NOT_APPROVED" title={title}>
          {label}
        </span>
      );
    }
    case 'unknown':
    default:
      return (
        <span
          className="badge UNKNOWN"
          title={m.reason ?? "Mergeability couldn't be determined"}
        >
          UNKNOWN
        </span>
      );
  }
}

function pickTarget(
  targets: PullRequestTarget[],
  differences: PRDifferences | null,
): PullRequestTarget | undefined {
  if (!differences) return targets[0];
  return (
    targets.find(
      (t) =>
        t.repositoryName.toLowerCase() ===
        differences.repositoryName.toLowerCase(),
    ) ?? targets[0]
  );
}

function stripRefs(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
}

function shortArn(arn: string | undefined): string {
  if (!arn) return 'unknown';
  const i = arn.lastIndexOf('/');
  return i >= 0 ? arn.slice(i + 1) : arn;
}

function fmtRel(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const sign = diff >= 0 ? '' : 'in ';
  const suffix = diff >= 0 ? ' ago' : '';
  if (abs < minute) return diff >= 0 ? 'just now' : 'in moments';
  if (abs < hour) return `${sign}${Math.round(abs / minute)}m${suffix}`;
  if (abs < day) return `${sign}${Math.round(abs / hour)}h${suffix}`;
  if (abs < week) return `${sign}${Math.round(abs / day)}d${suffix}`;
  if (abs < month) return `${sign}${Math.round(abs / week)}w${suffix}`;
  return new Date(t).toLocaleDateString();
}
