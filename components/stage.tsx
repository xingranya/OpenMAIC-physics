'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStageStore } from '@/lib/store';
import { isCurrentSceneEditable, resolveStageChromeMode } from '@/lib/edit/stage-mode';
import { isMaicEditorEnabled } from '@/lib/config/feature-flags';
import { EditChromeRoot } from '@/components/edit/EditChromeRoot';
import {
  PlaybackChromeRoot,
  type PlaybackChromeRootHandle,
} from '@/components/edit/PlaybackChromeRoot';
import {
  InteractiveIframeHost,
  type PlaybackInteractiveComponentPick,
  type PlaybackInteractivePickerState,
} from '@/components/scene-renderers/InteractiveIframeHost';
import { CHROME_EASE } from '@/lib/edit/transitions';
import { enterEditMode } from '@/lib/edit/enter-edit-mode';
import { preloadEditor } from '@/lib/edit/preload-editor';

/**
 * Stage — top-level classroom container. Standalone classrooms dispatch
 * between the two chrome roots based on `useStageStore.mode`:
 *
 *   mode === 'edit'                → EditChromeRoot
 *   mode === 'playback' / 'autonomous' → PlaybackChromeRoot
 *
 * 上游的「Pro 工作台（/workspace）」外壳已随 M9 删减一并移除：课堂不再有
 * 「被工作台面板托管」的第二种形态，因此本组件只服务独立课堂路由。
 * `resolveStageChromeMode` 的 hosted 分支（工作台托管课堂）在没有工作台的
 * 产品里恒不成立，这里显式传 `hosted: false`，而不是保留一条永远走不到的
 * 托管路径——留着它就等于把 `/workspace` 这个已删除的入口留在课堂页里。
 *
 * Stage 的职责只有两件：模式分发，以及 Pro 开关的接线（翻转前先经 ref
 * 调用 PlaybackChromeRoot.teardown）。
 */
export function Stage({
  classroomId,
  onRetryOutline,
}: {
  classroomId?: string;
  onRetryOutline?: (outlineId: string) => Promise<void>;
}) {
  const { mode, setMode, scenes, currentSceneId, generatingOutlines, stage } = useStageStore();
  const editorEnabled = isMaicEditorEnabled();
  const currentScene = useStageStore((s) => s.getCurrentScene());
  // The reference implementation makes editing owner-only. `isOwner` is true for the stage creator and
  // defaults to true with browser storage (single-user IndexedDB), so this gate is
  // a no-op upstream but hides Pro mode from visitors / bookmarked viewers in
  // server-backed mode — their saves would not pass the owner check anyway.
  const isOwner = useStageStore((s) => s.isOwner);
  const readOnly = useStageStore((s) => s.readOnly);
  const canEditOwnedStage = isOwner && !readOnly;

  // Predicate for "can the user enter Pro mode for the current scene?".
  // Single source of truth feeds the Header's Pro Switch state and the
  // auto-exit effect below; keeping them in lock-step prevents an
  // edit-mode entry that would immediately auto-exit.
  const isEditable =
    canEditOwnedStage &&
    isCurrentSceneEditable({
      currentSceneId,
      sceneCount: scenes.length,
      generatingOutlineCount: generatingOutlines.length,
      hasCurrentScene: !!currentScene,
    });

  // Hosted generation is page-granular: once the current page materialises,
  // the human may edit it while the agent writes later scene IDs. Keep the
  // stricter whole-deck generation gate above for standalone Pro mode.
  const currentStageMatchesHost = !classroomId || stage?.id === classroomId;
  const chromeEditable = isEditable;

  // The workspace owns the edit/playback intent — but the workspace is gone,
  // so an independent classroom keeps its own stored mode. `hosted: false`
  // makes `resolveStageChromeMode` answer with that stored mode directly;
  // the hosted branch it guards is the removed Pro workspace.
  const chromeMode = resolveStageChromeMode({
    storedMode: mode,
    hosted: false,
    workbenchShowingClassroom: false,
    workbenchLearning: false,
    isEditable: chromeEditable,
    hasCurrentScene: !!currentScene,
    stageMatchesHost: currentStageMatchesHost,
    editorReady: true,
    editorLoadFailed: false,
  });

  const playbackRef = useRef<PlaybackChromeRootHandle>(null);
  const [playbackInteractivePicker, setPlaybackInteractivePicker] =
    useState<PlaybackInteractivePickerState | null>(null);
  const handlePlaybackInteractivePick = useCallback((pick: PlaybackInteractiveComponentPick) => {
    playbackRef.current?.acceptInteractivePick(pick);
  }, []);
  const handlePlaybackInteractiveCancel = useCallback(() => {
    playbackRef.current?.cancelElementPick();
  }, []);

  // Pro Switch handler. Edit→playback is a plain flip (PlaybackChromeRoot
  // will mount fresh; its engine effect re-inits). Playback→edit must
  // await SSE / engine / TTS teardown so PlaybackChromeRoot is quiescent
  // before it unmounts.
  const handleToggleEditMode = useCallback(async () => {
    if (mode === 'edit') {
      setMode('playback');
      return;
    }
    // Load the editor chunk (fonts + slide surface) BEFORE flipping mode,
    // so the edit chrome animates in with its content already present and
    // the slide surface registered — no mid-animation pop-in / NOOP flash.
    // Runs concurrently with teardown; the import is promise-cached so it's
    // a no-op on subsequent toggles.
    await enterEditMode({
      teardown: () => playbackRef.current?.teardown(),
      preload: preloadEditor,
      activate: () => setMode('edit'),
      // Stay in playback so the failure surfaces rather than half-entering
      // edit mode.
      onError: (error) => console.error('[Stage] Pro mode entry failed during teardown', error),
    });
  }, [mode, setMode]);

  // Auto-exit edit mode when the current scene becomes uneditable
  // (pending generation, no scenes, currently generating).
  useEffect(() => {
    if (mode === 'edit' && !isEditable) {
      setMode('playback');
    }
  }, [mode, isEditable, setMode]);

  // Non-owners and transport-fenced owners get no Pro toggle at all: without a
  // handler the Header/CommandBar omit the whole switch. Editable owners keep
  // it while a scene is still generating (rendered disabled), matching upstream.
  const toggleHandler = editorEnabled && canEditOwnedStage ? handleToggleEditMode : undefined;

  // The Pro switch of an independent classroom: it flips this classroom
  // between edit and playback. The upstream "enter the Pro workspace" branch
  // is gone together with `/workspace`.
  const chromeToggleHandler = !isOwner ? undefined : toggleHandler;

  // Mode swap choreography — a clean opacity cross-fade. Both roots layer
  // via `absolute inset-0` so they coexist for the ~280ms window without
  // one popping out before the other arrives. The outgoing root keeps
  // rendering its canvas during exit so `canvasStore` (the shared scale
  // writer) doesn't briefly read zero.
  //
  // Deliberately NO transform (translateY) on these layers: the edit
  // chrome hosts the Pro Switch / settings pill, which morph across the
  // swap via `layoutId`. A transform on this ancestor distorts motion's
  // layout measurement (the pill visibly drifts) and the blurred chrome
  // would repaint its backdrop-filter every frame while translating. A
  // pure fade keeps layout static so the shared elements land precisely.
  //
  // The classroom itself is built once and mounted either full-bleed (the
  // route) or inside the workspace's classroom pane: there is exactly one of
  // these expressions in the app, so "the pane IS the classroom" is
  // structural rather than aspirational.
  const classroomChrome = (
    <AnimatePresence initial={false}>
      {/* The dispatch is exhaustive on `chromeMode` on purpose. The learning
          chrome is reached ONLY by an explicit playback resolution, so it can
          no longer be inherited as the else-branch of a condition about
          something else — a resolved `edit` with no scene to hand shows the
          neutral shell and waits, exactly as `loading` does. */}
      {chromeMode === 'edit' && currentScene ? (
        <motion.div
          key="edit"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: CHROME_EASE }}
          className="absolute inset-0 flex"
        >
          <EditChromeRoot
            scene={currentScene}
            isEditable={chromeEditable}
            onToggleEditMode={chromeToggleHandler}
          />
        </motion.div>
      ) : chromeMode === 'playback' || chromeMode === 'autonomous' ? (
        <motion.div
          key="playback"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: CHROME_EASE }}
          className="absolute inset-0 flex"
        >
          <PlaybackChromeRoot
            ref={playbackRef}
            onInteractivePickerChange={setPlaybackInteractivePicker}
            onRetryOutline={onRetryOutline}
            canEnterProMode={isEditable}
            onEnterProMode={chromeToggleHandler}
            proModeActive={false}
            headerBackControl={undefined}
            hideHeaderBackControl={false}
            hideHeader={false}
            hideHeaderGlobalControls={false}
            hideHeaderCourseActions={false}
          />
        </motion.div>
      ) : (
        <div
          key="loading"
          data-testid="stage-editor-loading"
          className="absolute inset-0 flex bg-background"
          aria-busy="true"
        />
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* The edit-mode guard has been removed (#1961 decision change 2026-08-23): a
          new agent version directly replaces the canvas; the user's typed data is
          protected by the write-path veto/retry channel (see lib/store/stage.ts),
          and there is no longer an "agent modified this page" banner or a manual
          reload entry. */}
      {classroomChrome}
      {/* Keep-alive host for interactive scene iframes (#619). Lives here, above
          the mode-swap subtree, so its iframes survive Pro mode toggles and
          scene switches instead of reloading on every remount. */}
      <InteractiveIframeHost
        playbackPicker={playbackInteractivePicker}
        onPlaybackPick={handlePlaybackInteractivePick}
        onPlaybackCancel={handlePlaybackInteractiveCancel}
      />
    </div>
  );
}
