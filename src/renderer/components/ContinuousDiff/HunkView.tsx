import { Fragment } from 'react';
import type {
  CommentThread,
  DiffHunk,
  DiffLine,
  RelativeFileVersion,
} from '@shared/types';
import { InlineThread } from './InlineThread';
import { InlineComposer } from './InlineComposer';
import {
  type ComposerLocation,
  type DiffCallbacks,
  type DiffContext,
  type DraftsByLine,
  type ThreadsByLine,
  threadsForLineKey,
} from './types';

interface Props {
  filePath: string;
  hunk: DiffHunk;
  threads: ThreadsByLine;
  drafts: DraftsByLine;
  composerAt: ComposerLocation | null;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  onOpenComposer: (loc: ComposerLocation) => void;
  onCloseComposer: () => void;
}

export function HunkView({
  filePath,
  hunk,
  threads,
  drafts,
  composerAt,
  ctx,
  callbacks,
  onOpenComposer,
  onCloseComposer,
}: Props): JSX.Element {
  return (
    <>
      {!hunk.isExpansion && (
        <div className="hunk-header">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </div>
      )}
      {hunk.lines.map((line, i) => {
        const sideForClick: RelativeFileVersion =
          line.type === 'del' ? 'BEFORE' : 'AFTER';
        const lineForClick =
          sideForClick === 'AFTER' ? line.newLineNumber : line.oldLineNumber;

        const afterThreads =
          line.newLineNumber !== undefined
            ? (threads.byKey.get(threadsForLineKey('AFTER', line.newLineNumber)) ?? [])
            : [];
        const beforeThreads =
          line.oldLineNumber !== undefined
            ? (threads.byKey.get(threadsForLineKey('BEFORE', line.oldLineNumber)) ?? [])
            : [];

        const composerOpenHere =
          composerAt &&
          composerAt.filePath === filePath &&
          composerAt.line === lineForClick &&
          composerAt.side === sideForClick;

        return (
          <Fragment key={`${hunk.oldStart}:${hunk.newStart}:${i}`}>
            <DiffLineRow
              line={line}
              onAdd={
                lineForClick
                  ? () =>
                      onOpenComposer({
                        filePath,
                        line: lineForClick,
                        side: sideForClick,
                      })
                  : undefined
              }
            />
            {beforeThreads.map((t) => (
              <ThreadRow
                key={`bt-${t.threadId}`}
                thread={t}
                ctx={ctx}
                callbacks={callbacks}
              />
            ))}
            {afterThreads.map((t) => (
              <ThreadRow
                key={`at-${t.threadId}`}
                thread={t}
                ctx={ctx}
                callbacks={callbacks}
              />
            ))}
            {composerOpenHere && lineForClick !== undefined && (
              <ComposerRow
                location={{
                  filePath,
                  line: lineForClick,
                  side: sideForClick,
                }}
                drafts={drafts}
                ctx={ctx}
                callbacks={callbacks}
                onClose={onCloseComposer}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function DiffLineRow({
  line,
  onAdd,
}: {
  line: DiffLine;
  onAdd?: () => void;
}): JSX.Element {
  const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  return (
    <div className={`drow drow-${line.type}`}>
      <div className="dgutter old">
        {line.oldLineNumber ?? ''}
        {onAdd && (
          <button
            className="add-comment-btn"
            onClick={onAdd}
            title="Comment on this line"
          >
            +
          </button>
        )}
      </div>
      <div className="dgutter new">{line.newLineNumber ?? ''}</div>
      <div className="dmark">{marker}</div>
      <div className="dcontent">
        {line.content === '' ? ' ' : line.content}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  ctx,
  callbacks,
}: {
  thread: CommentThread;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
}): JSX.Element {
  const posting = ctx.postingThreadId === thread.threadId;
  return (
    <div className="drow drow-thread">
      <div className="thread-row-content">
        <InlineThread
          thread={thread}
          posting={posting}
          onReply={(content) => callbacks.onPostReply(thread.threadId, content)}
        />
      </div>
    </div>
  );
}

function ComposerRow({
  location,
  drafts,
  ctx,
  callbacks,
  onClose,
}: {
  location: ComposerLocation;
  drafts: DraftsByLine;
  ctx: DiffContext;
  callbacks: DiffCallbacks;
  onClose: () => void;
}): JSX.Element {
  const existing = drafts.byKey.get(
    threadsForLineKey(location.side, location.line),
  );
  return (
    <div className="drow drow-composer">
      <div className="thread-row-content">
        <InlineComposer
          side={location.side}
          filePath={location.filePath}
          line={location.line}
          draftId={existing?.id}
          initialContent={existing?.content}
          posting={ctx.postingThreadId === '__composer__'}
          onPost={async (content) => {
            await callbacks.onPostComment({
              pullRequestId: ctx.pullRequestId,
              repositoryName: ctx.repositoryName,
              beforeCommitId: ctx.beforeCommitId,
              afterCommitId: ctx.afterCommitId,
              filePath: location.filePath,
              filePosition: location.line,
              relativeFileVersion: location.side,
              content,
            });
            if (existing) await callbacks.onDeleteDraft(existing.id);
            onClose();
          }}
          onSaveDraft={async (content) => {
            await callbacks.onSaveDraft({
              id: existing?.id,
              filePath: location.filePath,
              filePosition: location.line,
              relativeFileVersion: location.side,
              content,
            });
            onClose();
          }}
          onDeleteDraft={async () => {
            if (existing) await callbacks.onDeleteDraft(existing.id);
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
