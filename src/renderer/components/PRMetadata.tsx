import { useState } from 'react';
import type {
  ApprovalStateEntry,
  PRDifferences,
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestTarget,
} from '@shared/types';
import { Markdown } from './Markdown';

interface Props {
  detail: PullRequestDetail;
  differences: PRDifferences | null;
  mergeability: PullRequestMergeability | null;
  approval: PullRequestApprovalView | null;
  approvalCount: number;
  // null while the differences are still streaming in — the row shows a quiet
  // pulsing placeholder until the real count lands.
  fileCount: number | null;
  selfApproved: boolean;
  // Provider-built deep-link to the PR's web UI. Undefined when the provider
  // can't construct one (e.g. no region configured).
  webUrl?: string;
}

export function PRMetadata({
  detail,
  differences,
  mergeability,
  approval,
  approvalCount,
  fileCount,
  selfApproved,
  webUrl,
}: Props): JSX.Element {
  // Long descriptions get collapsed by default with a "Show more" toggle so
  // they don't push the diff out of view. Short ones render inline.
  const [descExpanded, setDescExpanded] = useState(false);
  const target = pickTarget(detail.targets, differences);
  const approvers = (approval?.states ?? []).filter(
    (s) => s.approvalState === 'APPROVE',
  );

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
        {fileCount === null ? (
          <span
            className="pr-meta-pending"
            role="status"
            aria-label="counting changed files"
          />
        ) : (
          <span className="hint">
            {fileCount} file{fileCount === 1 ? '' : 's'} changed
          </span>
        )}
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
        {webUrl && (
          <>
            <span className="grow" />
            <button
              type="button"
              className="link pr-aws-link"
              title="Open this PR in the AWS CodeCommit console"
              onClick={() => {
                // Use window.open so Electron's setWindowOpenHandler routes
                // it to shell.openExternal. The pr-meta surface isn't a
                // window-drag region, but going through window.open also
                // avoids any future drag/region regressions on a click handler.
                window.open(webUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              Open in AWS ↗
            </button>
          </>
        )}
      </div>

      {mergeability?.state === 'already_merged' && (
        <div className="pr-meta-row">
          <span className="pr-meta-label">Merged</span>
          {mergeability.mergedBy ? (
            <code className="who">{shortArn(mergeability.mergedBy)}</code>
          ) : (
            <span className="hint">unknown user</span>
          )}
          {mergeability.mergedAt && (
            <>
              <span className="hint">·</span>
              <span className="hint" title={mergeability.mergedAt}>
                {fmtRel(mergeability.mergedAt)}
              </span>
            </>
          )}
          {mergeability.mergedWith && (
            <>
              <span className="hint">·</span>
              <span className="hint">
                via {labelForMergeOption(mergeability.mergedWith)}
              </span>
            </>
          )}
          {mergeability.mergeCommitId && (
            <code className="commit-pair-code" title={mergeability.mergeCommitId}>
              {mergeability.mergeCommitId.slice(0, 7)}
            </code>
          )}
        </div>
      )}

      {mergeability?.state === 'closed_unmerged' && (
        <div className="pr-meta-row">
          <span className="pr-meta-label">Closed</span>
          {mergeability.closedBy ? (
            <code className="who">{shortArn(mergeability.closedBy)}</code>
          ) : (
            <span className="hint">unknown user</span>
          )}
          {mergeability.closedAt && (
            <>
              <span className="hint">·</span>
              <span className="hint" title={mergeability.closedAt}>
                {fmtRel(mergeability.closedAt)}
              </span>
            </>
          )}
          <span className="hint">· without merging</span>
        </div>
      )}

      {approvers.length > 0 && (
        <div className="pr-meta-row pr-approvers-row">
          <span className="pr-meta-label">Approved by</span>
          <ul className="pr-approvers">
            {approvers.map((a) => (
              <ApproverChip
                key={a.userArn}
                entry={a}
                isSelf={!!approval?.selfArn && a.userArn === approval.selfArn}
              />
            ))}
          </ul>
        </div>
      )}

      {detail.description && (
        <div className="pr-meta-row pr-description-row">
          <span className="pr-meta-label">Description</span>
          <div
            className={`pr-description${descExpanded ? ' is-expanded' : ''}`}
          >
            <Markdown source={detail.description} />
            <button
              type="button"
              className="pr-description-toggle"
              onClick={() => setDescExpanded((v) => !v)}
            >
              {descExpanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApproverChip({
  entry,
  isSelf,
}: {
  entry: ApprovalStateEntry;
  isSelf: boolean;
}): JSX.Element {
  return (
    <li className="pr-approver" title={entry.userArn}>
      <span className="pr-approver-check" aria-hidden="true">
        ✓
      </span>
      <code className="who">{shortArn(entry.userArn)}</code>
      {isSelf && <span className="pr-approver-self">you</span>}
      {entry.changedAt && (
        <span className="hint" title={entry.changedAt}>
          {fmtRel(entry.changedAt)}
        </span>
      )}
    </li>
  );
}

function labelForMergeOption(opt: string): string {
  switch (opt) {
    case 'FAST_FORWARD_MERGE':
      return 'fast-forward';
    case 'SQUASH_MERGE':
      return 'squash';
    case 'THREE_WAY_MERGE':
      return 'three-way merge';
    default:
      return opt;
  }
}

function MergeabilityBadge({
  m,
}: {
  m: PullRequestMergeability;
}): JSX.Element | null {
  switch (m.state) {
    // Closed-without-merge already shows up as the "CLOSED" status badge
    // (rendered by the parent) plus a "Closed by X · Y ago" row. A second
    // badge here would just be noise.
    case 'closed_unmerged':
      return null;
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
