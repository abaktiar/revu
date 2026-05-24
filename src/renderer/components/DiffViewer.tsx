import { useEffect, useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monaco } from '../monaco/setup';
import { languageFor } from '../monaco/language';
import type {
  CommentDraft,
  CommentThread,
  PostCommentInput,
  RelativeFileVersion,
} from '@shared/types';
import { CommentThreadView } from './CommentThreadView';
import { CommentComposer } from './CommentComposer';

interface Props {
  filePath: string;
  originalText: string;
  modifiedText: string;
  beforeCommitId: string;
  afterCommitId: string;
  pullRequestId: string;
  repositoryName: string;
  threads: CommentThread[];
  drafts: CommentDraft[];
  // Identity changes when threads on the server have been refreshed; we use
  // this to drop optimistic state without churning on every parent rerender.
  threadsVersion: number;
  postingThreadId: string | null;
  onPostComment: (input: PostCommentInput) => Promise<void>;
  onPostReply: (threadId: string, content: string) => Promise<void>;
  onSaveDraft: (input: {
    id?: string;
    filePath: string;
    filePosition: number;
    relativeFileVersion: RelativeFileVersion;
    content: string;
  }) => Promise<void>;
  onDeleteDraft: (id: string) => Promise<void>;
}

interface ZoneRef {
  id: string;
  side: RelativeFileVersion;
  line: number;
  node: HTMLDivElement;
  root: Root;
  ro: ResizeObserver;
  // For threads: the threadId; for the composer: undefined.
  threadId?: string;
}

interface ComposerState {
  side: RelativeFileVersion;
  line: number;
  draftId?: string;
  initialContent?: string;
}

export function DiffViewer(props: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const threadZonesRef = useRef<Map<string, ZoneRef>>(new Map());
  const composerZoneRef = useRef<ZoneRef | null>(null);
  const composerStateRef = useRef<ComposerState | null>(null);
  // A ref to the latest props so handlers added once still see current data.
  const propsRef = useRef(props);
  propsRef.current = props;

  const language = useMemo(() => languageFor(props.filePath), [props.filePath]);

  // ---- Mount Monaco diff editor once ---------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      originalEditable: false,
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      fontSize: 12,
      lineNumbersMinChars: 4,
      theme: 'vs-dark',
      glyphMargin: true,
    });
    editorRef.current = editor;

    const original = editor.getOriginalEditor();
    const modified = editor.getModifiedEditor();

    const handler = (side: RelativeFileVersion) =>
      (e: monaco.editor.IEditorMouseEvent) => {
        if (
          e.target.type !==
            monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
          e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ) {
          return;
        }
        const line = e.target.position?.lineNumber;
        if (!line) return;
        openComposer({ side, line });
      };

    const d1 = original.onMouseDown(handler('BEFORE'));
    const d2 = modified.onMouseDown(handler('AFTER'));

    return () => {
      d1.dispose();
      d2.dispose();
      teardownAllZones();
      const orig = editor.getOriginalEditor().getModel();
      const mod = editor.getModifiedEditor().getModel();
      editor.dispose();
      orig?.dispose();
      mod?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Swap models when file or content changes ----------------------
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const original = monaco.editor.createModel(props.originalText, language);
    const modified = monaco.editor.createModel(props.modifiedText, language);
    const oldOrig = editor.getOriginalEditor().getModel();
    const oldMod = editor.getModifiedEditor().getModel();
    editor.setModel({ original, modified });
    oldOrig?.dispose();
    oldMod?.dispose();
    // File switched → close composer, rebuild thread zones (handled by next effect).
    closeComposer();
  }, [props.filePath, props.originalText, props.modifiedText, language]);

  // ---- Sync thread view zones ----------------------------------------
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    syncThreadZones(editor, props.threads);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.threads, props.threadsVersion, props.filePath]);

  // Rerender any existing zones when handlers/state needed by them change
  // (e.g. postingThreadId). The zone roots read from propsRef, but we still
  // need to call render() to push fresh props.
  useEffect(() => {
    for (const z of threadZonesRef.current.values()) {
      renderThreadZone(z);
    }
    if (composerZoneRef.current && composerStateRef.current) {
      renderComposerZone(composerZoneRef.current, composerStateRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.postingThreadId, props.drafts]);

  // -------------------------------------------------------------------
  function syncThreadZones(
    editor: monaco.editor.IStandaloneDiffEditor,
    threads: CommentThread[],
  ): void {
    // Tear down current thread zones (composer is preserved).
    for (const z of threadZonesRef.current.values()) {
      teardownZone(z);
    }
    threadZonesRef.current.clear();

    const original = editor.getOriginalEditor();
    const modified = editor.getModifiedEditor();

    for (const t of threads) {
      if (!t.filePath || !t.filePosition || !t.relativeFileVersion) continue;
      const targetEditor = t.relativeFileVersion === 'AFTER' ? modified : original;
      const z = mountZone(
        targetEditor,
        t.filePosition,
        t.relativeFileVersion,
        t.threadId,
      );
      threadZonesRef.current.set(t.threadId, z);
      renderThreadZone(z);
    }
  }

  function renderThreadZone(z: ZoneRef): void {
    const thread = propsRef.current.threads.find((t) => t.threadId === z.threadId);
    if (!thread) return;
    const posting = propsRef.current.postingThreadId === z.threadId;
    z.root.render(
      <CommentThreadView
        thread={thread}
        posting={posting}
        onReply={(content) =>
          propsRef.current.onPostReply(z.threadId!, content)
        }
      />,
    );
  }

  function openComposer(state: ComposerState): void {
    const editor = editorRef.current;
    if (!editor) return;
    closeComposer();
    const target =
      state.side === 'AFTER'
        ? editor.getModifiedEditor()
        : editor.getOriginalEditor();
    // Find any existing draft for this exact location to prefill.
    const existing = propsRef.current.drafts.find(
      (d) =>
        d.filePath === propsRef.current.filePath &&
        d.filePosition === state.line &&
        d.relativeFileVersion === state.side,
    );
    const merged: ComposerState = {
      ...state,
      draftId: existing?.id,
      initialContent: existing?.content,
    };
    composerStateRef.current = merged;
    const z = mountZone(target, state.line, state.side);
    composerZoneRef.current = z;
    renderComposerZone(z, merged);
  }

  function closeComposer(): void {
    if (composerZoneRef.current) {
      teardownZone(composerZoneRef.current);
      composerZoneRef.current = null;
    }
    composerStateRef.current = null;
  }

  function renderComposerZone(z: ZoneRef, st: ComposerState): void {
    z.root.render(
      <CommentComposer
        side={st.side}
        filePath={propsRef.current.filePath}
        line={st.line}
        draftId={st.draftId}
        initialContent={st.initialContent}
        posting={propsRef.current.postingThreadId === '__composer__'}
        onPost={async (content) => {
          await propsRef.current.onPostComment({
            pullRequestId: propsRef.current.pullRequestId,
            repositoryName: propsRef.current.repositoryName,
            beforeCommitId: propsRef.current.beforeCommitId,
            afterCommitId: propsRef.current.afterCommitId,
            filePath: propsRef.current.filePath,
            filePosition: st.line,
            relativeFileVersion: st.side,
            content,
          });
          if (st.draftId) {
            await propsRef.current.onDeleteDraft(st.draftId);
          }
          closeComposer();
        }}
        onSaveDraft={async (content) => {
          await propsRef.current.onSaveDraft({
            id: st.draftId,
            filePath: propsRef.current.filePath,
            filePosition: st.line,
            relativeFileVersion: st.side,
            content,
          });
          closeComposer();
        }}
        onDeleteDraft={async () => {
          if (st.draftId) await propsRef.current.onDeleteDraft(st.draftId);
          closeComposer();
        }}
        onCancel={() => closeComposer()}
      />,
    );
  }

  function mountZone(
    target: monaco.editor.ICodeEditor,
    line: number,
    side: RelativeFileVersion,
    threadId?: string,
  ): ZoneRef {
    const node = document.createElement('div');
    node.className = 'view-zone';
    const root = createRoot(node);
    let currentId = '';
    let currentHeight = 80;

    target.changeViewZones((acc) => {
      currentId = acc.addZone({
        afterLineNumber: line,
        heightInPx: currentHeight,
        domNode: node,
      });
    });

    const ro = new ResizeObserver(() => {
      const newHeight = Math.max(60, node.scrollHeight);
      if (Math.abs(newHeight - currentHeight) < 2) return;
      currentHeight = newHeight;
      target.changeViewZones((acc) => {
        acc.removeZone(currentId);
        currentId = acc.addZone({
          afterLineNumber: line,
          heightInPx: currentHeight,
          domNode: node,
        });
      });
      // Keep our ZoneRef in sync so teardown removes the right one.
      const ref =
        threadId !== undefined
          ? threadZonesRef.current.get(threadId)
          : composerZoneRef.current;
      if (ref) ref.id = currentId;
    });
    ro.observe(node);

    return {
      id: currentId,
      side,
      line,
      node,
      root,
      ro,
      threadId,
    };
  }

  function teardownZone(z: ZoneRef): void {
    z.ro.disconnect();
    z.root.unmount();
    const editor = editorRef.current;
    if (!editor) return;
    const target =
      z.side === 'AFTER'
        ? editor.getModifiedEditor()
        : editor.getOriginalEditor();
    target.changeViewZones((acc) => acc.removeZone(z.id));
  }

  function teardownAllZones(): void {
    for (const z of threadZonesRef.current.values()) teardownZone(z);
    threadZonesRef.current.clear();
    if (composerZoneRef.current) teardownZone(composerZoneRef.current);
    composerZoneRef.current = null;
    composerStateRef.current = null;
  }

  return <div className="diff-host" ref={containerRef} />;
}
