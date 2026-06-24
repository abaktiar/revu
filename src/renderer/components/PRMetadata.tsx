import { useState } from 'react';
import type {
  ApprovalRuleView,
  ApprovalStateEntry,
  PRDifferences,
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestTarget,
} from '@shared/types';
import { Markdown } from './Markdown';
import {
  ArrowRight,
  Check,
  ExternalLink,
  GitMerge,
  User as UserIcon,
} from '../icons';

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
        <ArrowRight size={12} className="branch-arrow" aria-hidden />
        <code className="branch dest" title={target?.destinationReference}>
          {dest || '?'}
        </code>
        {target?.sourceCommitId && (
          <span className="commit-pair">
            <code title="source commit">
              {target.sourceCommitId.slice(0, 7)}
            </code>
            <ArrowRight size={11} className="branch-arrow" aria-hidden />
            <code title="merge base / destination">
              {(target.mergeBase ?? target.destinationCommitId ?? '').slice(0, 7) ||
                '?'}
            </code>
          </span>
        )}
      </div>

      <div className="pr-meta-row">
        <span className="pr-meta-label">Status</span>
        <span className={`pill pill-${detail.status.toLowerCase()}`}>{detail.status}</span>
        {mergeability && <MergeabilityBadge m={mergeability} />}
        <span className={`pill pill-${detail.approvalState.toLowerCase()}`}>
          {detail.approvalState.replace('_', ' ')}
        </span>
        <span className="hint">
          {approvalCount} approval{approvalCount === 1 ? '' : 's'}
          {selfApproved && (
            <span className="self-approved">
              <Check size={11} /> you
            </span>
          )}
        </span>
        <span className="meta-sep" />
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
        <code className="who">
          <UserIcon size={11} className="who-icon" aria-hidden />
          {shortArn(detail.authorArn)}
        </code>
        <span className="hint">opened</span>
        <span className="hint" title={detail.createdAt}>
          {fmtRel(detail.createdAt)}
        </span>
        <span className="meta-sep" />
        <span className="hint">updated</span>
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
              <ExternalLink size={12} />
              Open in AWS
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
              <span className="meta-sep" />
              <span className="hint" title={mergeability.mergedAt}>
                {fmtRel(mergeability.mergedAt)}
              </span>
            </>
          )}
          {mergeability.mergedWith && (
            <>
              <span className="meta-sep" />
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
              <span className="meta-sep" />
              <span className="hint" title={mergeability.closedAt}>
                {fmtRel(mergeability.closedAt)}
              </span>
            </>
          )}
          <span className="meta-sep" />
          <span className="hint">without merging</span>
        </div>
      )}

      {approval?.rules && approval.rules.length > 0 && (
        <div className="pr-meta-row pr-rules-row">
          <span className="pr-meta-label">Approval rules</span>
          <ul className="pr-rules">
            {approval.rules.map((r) => (
              <ApprovalRuleChip
                key={r.name}
                rule={r}
                overridden={approval.overridden ?? false}
              />
            ))}
          </ul>
          {approval.overridden && (
            <span
              className="pr-rule-overridden"
              title="An admin overrode the approval rules; they no longer need to be met."
            >
              overridden
            </span>
          )}
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

function ApprovalRuleChip({
  rule,
  overridden,
}: {
  rule: ApprovalRuleView;
  overridden: boolean;
}): JSX.Element {
  const met = rule.satisfied || overridden;
  const poolTitle =
    rule.approverPool.length > 0
      ? `Can approve:\n  ${rule.approverPool.join('\n  ')}`
      : 'Anyone can approve';
  return (
    <li className={`pr-rule${met ? ' is-met' : ''}`} title={poolTitle}>
      <span className="pr-rule-check" aria-hidden="true">
        {met ? <Check size={12} /> : <span className="pr-rule-dot" />}
      </span>
      <span className="pr-rule-name">{rule.name}</span>
      <span className="pr-rule-count" aria-label={`${rule.currentCount} of ${rule.requiredCount} approvals`}>
        {rule.currentCount} of {rule.requiredCount}
      </span>
      {rule.isTemplate && (
        <span
          className="pr-rule-template"
          title={
            rule.templateName
              ? `From approval rule template "${rule.templateName}"`
              : 'From an approval rule template'
          }
        >
          template
        </span>
      )}
    </li>
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
        <Check size={12} />
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
        <span className="pill pill-merged" title={title}>
          <GitMerge size={11} />
          MERGED
        </span>
      );
    }
    case 'mergeable': {
      const title = `Mergeable via: ${m.mergeOptions.join(', ') || '?'}`;
      return (
        <span className="pill pill-approved" title={title}>
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
        <span className="pill pill-not_approved" title={title}>
          {label}
        </span>
      );
    }
    case 'unknown':
    default:
      return (
        <span
          className="pill pill-unknown"
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
