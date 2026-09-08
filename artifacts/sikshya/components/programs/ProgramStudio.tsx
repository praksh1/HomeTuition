import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  canMoveDown,
  canMoveUp,
  confirmCopy,
  emptyModule,
  moveModule,
  placeIssues,
  programActions,
  programStatusChip,
  programTitle,
  programTypeLabel,
  publishBlock,
  publishOffer,
  saveChip,
  studioSections,
  wouldLoseWork,
  type ProgramAction,
  type ProgramDetail,
  type ProgramDraft,
  type ProgramIssue,
  type ProgramModuleDraft,
  type SaveState,
  type StudioField,
} from "@/utils/learningProgramUi";
import {
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramNotice,
  SectionHeading,
  toneColours,
} from "./ProgramPieces";

/**
 * The program studio: one program, in sections a teacher can hold in their head.
 *
 * ## Sections rather than a form
 *
 * Six of them, and each is a question a teacher already has an answer to — what students will
 * learn, who it is for, the path, the requirements, the reference, and then review. A single
 * scrolling form of eleven inputs is the desktop-shaped thing the brief rules out, and on a 390pt
 * phone it is also a screen nobody finishes.
 *
 * Which sections and fields appear comes from `studioSections(type)`, so a practical skill is never
 * asked for a curriculum and an exam program is asked for its exact exam with the reason written
 * beside the field. That is progressive disclosure as a product rule, not a nicety.
 *
 * ## Nothing here validates
 *
 * Every issue drawn is one the **server** returned. `placeIssues` puts it beside the field it names,
 * and anything it cannot place is shown in Review rather than dropped — a teacher told "one thing
 * left" who cannot find it has been given a puzzle. Duplicating the rules in screen code is what the
 * brief forbids and what would drift the first time the contract changed.
 *
 * ## Saving is never claimed early
 *
 * `saveState` comes from the screen and only the API's answer moves it to `saved`. The chip is
 * always visible while there is work at risk.
 */

export interface ProgramStudioProps {
  program: ProgramDetail;
  /** The working copy. The screen owns it so a re-render cannot drop a keystroke. */
  draft: ProgramDraft;
  onDraftChange: (next: ProgramDraft) => void;
  saveState: SaveState;
  /** The message from a failed save, shown verbatim. Null when the last save succeeded. */
  saveError: string | null;
  onSave: () => void;
  /** Whether this teacher's account has been approved. Decides the publication explanation. */
  approved: boolean;
  onAction: (action: ProgramAction) => void;
  /** Set while a lifecycle action is in flight, so nothing is pressed twice. */
  busyAction: ProgramAction | null;
  actionError: string | null;
  onBack: () => void;
  /** Server templates for this type, for the prompts inside the sections. */
  template?: { promisePrompt?: string; learnerPrompt?: string; referencePrompt?: string | null } | null;
  /**
   * Set when something has tried to leave the studio with work at risk: call it to go anyway.
   *
   * The screen decides *what* leaving means — a route replace, or the navigation action React
   * Navigation was about to run — because only it knows which of the several ways out was taken.
   * The studio only draws the question.
   */
  leaveAsk?: (() => void) | null;
  onLeaveCancel?: () => void;
  /**
   * True while a lifecycle request is in flight: every field, every step control and Save go quiet.
   *
   * Not a nicety. Publish, take down, archive and restore act on the copy the server already has,
   * and their answers become this editor's new baseline — so text written during one belongs to a
   * draft that is about to be replaced by a response about a different one. The screen still keeps
   * anything that lands in the frame before this reaches the display, and marks it unsaved.
   */
  editingLocked?: boolean;
}

export default function ProgramStudio(props: ProgramStudioProps) {
  const { program, draft, onDraftChange, saveState, saveError, onSave, approved, onAction,
    busyAction, actionError, onBack, template, leaveAsk, onLeaveCancel,
    editingLocked = false } = props;
  const colors = useColors();
  const { t, gutter, space } = useLayout();

  const sections = useMemo(() => studioSections(draft.type, template), [draft.type, template]);
  const placed = useMemo(() => placeIssues(program.issues, draft.type), [program.issues, draft.type]);
  const status = programStatusChip(program);
  const save = saveChip(saveState);
  /*
    Unsaved, saving or failed — the three states in which the server's copy is not what is on
    screen. Everything on this screen that reads the server's copy is gated on it: the lifecycle
    buttons, because they act on the old text and their answers replace the new; and the readiness
    check, because the issues below describe the last draft the server was given.
  */
  const atRisk = wouldLoseWork(saveState);
  const [confirming, setConfirming] = useState<ProgramAction | null>(null);

  const set = (patch: Partial<ProgramDraft>) => onDraftChange({ ...draft, ...patch });
  const setModules = (modules: ProgramModuleDraft[]) => onDraftChange({ ...draft, modules });

  return (
    <ScrollView
      testID="program-studio"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: gutter,
        gap: space.xl,
        paddingBottom: space.huge,
        /*
          A readable column on a laptop, and nothing at all on a phone.

          The same cap the teacher dashboard uses. Without it the cards ran the full 1440 points and
          the page read as an admin table stretched across a metre of screen — which is the one look
          this studio is meant not to be.
        */
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ------------------------------------------------------------- header */}
      <View style={{ gap: space.sm }}>
        <Text
          testID="program-studio-back"
          accessibilityRole="link"
          accessibilityLabel="Back to your programs"
          onPress={onBack}
          style={[
            t.bodyStrong,
            {
              color: colors.primary,
              /*
                A 44-high target, and only as wide as the words.

                It was the height of its own text — 22 points on a phone — which is half the floor
                and the easiest control on the screen to miss with a thumb. `alignSelf` keeps the
                tap area off the rest of the row, so a teacher reaching for the title does not
                leave the studio instead.
              */
              minHeight: HIT_SLOP_MIN,
              lineHeight: HIT_SLOP_MIN,
              alignSelf: "flex-start",
            },
          ]}
        >
          ‹ Programs
        </Text>
        <Text style={[t.title1, { color: colors.foreground }]}>{programTitle(draft)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
          <ProgramChip testID="program-studio-status" label={status.label} tone={status.tone} />
          <ProgramChip label={programTypeLabel(draft.type)} />
          <ProgramChip testID="program-studio-save" label={save.label} tone={save.tone} />
        </View>
        {status.hint ? (
          <Text style={[t.callout, { color: colors.mutedForeground }]}>{status.hint}</Text>
        ) : null}
      </View>

      {leaveAsk ? (
        /*
          Something tried to leave while the server does not have this text.

          Whatever it was — the Back link, a tab, the Android button — the screen above hands over a
          single function that finishes the departure, so this only has to ask the question. Staying
          is the quiet default and leaving is the loud one, which is the opposite of how a sheet
          about a destructive action is drawn, because here the destructive choice is *going*.

          Directly under the header, beside the Back link that most often raises it. It was written
          at the foot of the studio, which on a phone put it four thousand points below the control
          that triggered it: a teacher tapped "‹ Programs", the page did not move, and nothing they
          could see had happened. A question nobody is shown is not a guard.
        */
        <ProgramNotice
          testID="program-leave-confirm"
          tone="stopped"
          icon="alert-triangle"
          title="You have changes Fadko has not saved"
          body="Leaving now loses what you have typed since your last save."
        >
          <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
            <ProgramButton
              testID="program-leave-stay"
              label="Stay and save"
              emphasis="primary"
              onPress={() => {
                onLeaveCancel?.();
                onSave();
              }}
              grow
            />
            <ProgramButton
              testID="program-leave-discard"
              label="Leave without saving"
              emphasis="quiet"
              spoken="Leave this program. What you have typed since your last save is lost"
              onPress={leaveAsk}
              grow
            />
          </View>
          <ProgramButton
            testID="program-leave-cancel"
            label="Keep editing"
            emphasis="quiet"
            onPress={() => onLeaveCancel?.()}
            grow
          />
        </ProgramNotice>
      ) : null}
      {saveState === "failed" ? (
        <ProgramNotice
          testID="program-studio-save-failed"
          tone="stopped"
          icon="alert-triangle"
          title="Your last change was not saved"
          /*
            The server's own sentence, and then the one thing it never says.

            A refusal from the API arrives worded for the problem — "A step needs a title", "That
            program has moved on" — and rewording it would send a teacher looking for the wrong
            thing. But none of those sentences answer the question actually being asked at that
            moment, which is whether the last twenty minutes of typing is gone. So the reassurance
            is appended rather than swapped in, and it is here rather than in the screen above,
            because it is true of every failure and not only of the ones with no message.
          */
          body={`${saveError ?? "Fadko could not reach the server."}\n\nYour work is still on this screen. Nothing you have typed has been lost.`}
        >
          <ProgramButton
            label="Save again"
            icon="refresh-cw"
            disabled={editingLocked}
            onPress={onSave}
            testID="program-studio-save-retry"
          />
        </ProgramNotice>
      ) : null}

      {actionError ? (
        <ProgramNotice
          testID="program-studio-action-failed"
          tone="stopped"
          icon="alert-triangle"
          title="That did not happen"
          body={actionError}
        />
      ) : null}

      {atRisk && program.issues.length > 0 ? (
        /*
          What is marked below is the server's answer about the *last saved* draft.

          It was being drawn against the text currently on screen, which is a different draft the
          moment anybody types. So a teacher could fix the outcome, watch "1 to finish" stay exactly
          where it was, and conclude the app had not noticed — or worse, see a field marked as fine
          that they had just emptied. Naming which draft was checked costs one line and makes the
          marks below true again.
        */
        <ProgramNotice
          testID="program-studio-stale-issues"
          tone="neutral"
          icon="info"
          title="What is marked below was checked at your last save"
          body="Save the draft to check what is on this screen now."
        />
      ) : null}

      {/* ------------------------------------------------------------ sections */}
      {sections.map((section) => {
        const issues = placed.sections[section.id];
        if (section.id === "path") {
          return (
            <View key={section.id} testID="program-section-path" style={{ gap: space.md }}>
              <SectionHeading title={section.title} blurb={section.blurb} issues={issues.count} stale={atRisk} testID="program-heading-path" />
              {issues.loose.map((issue) => (
                <IssueLine key={issue.field + issue.code} issue={issue} stale={atRisk} testID="program-issue-modules" />
              ))}
              <ModuleEditor
                modules={draft.modules}
                issues={placed.modules}
                stale={atRisk}
                locked={editingLocked}
                onChange={setModules}
              />
            </View>
          );
        }
        if (section.id === "review") {
          return (
            <View key={section.id} style={{ gap: space.xl }}>
              {/*
                Saving, before anything that ends the program.

                It used to sit at the very bottom, under Publish, Archive and Delete — so a teacher
                who had typed a paragraph had to scroll past the red button to keep it. Writing is
                the frequent act and deleting is the rare one; the frequent act does not go behind
                the dangerous one.
              */}
              <ProgramButton
                testID="program-studio-save-button"
                label={saveState === "saving" ? "Saving…" : "Save draft"}
                icon="save"
                emphasis="primary"
                busy={saveState === "saving"}
                // Locked during a lifecycle request too: a PATCH crossing a publish is two writes
                // racing for the same row, and whichever wins decides what students were given.
                disabled={editingLocked || saveState === "clean" || saveState === "saved"}
                spoken="Save this draft. Nothing is published"
                onPress={onSave}
                grow
              />
              <View testID="program-section-review" style={{ gap: space.md }}>
                <SectionHeading
                  title={section.title}
                  blurb={section.blurb}
                  issues={issues.count}
                  stale={atRisk}
                  testID="program-heading-review"
                />
                <ReviewAndPublish
                  program={program}
                  draft={draft}
                  approved={approved}
                  atRisk={atRisk}
                  saveState={saveState}
                  unplaced={placed.unplaced}
                  onAction={(action) => setConfirming(action)}
                  busyAction={busyAction}
                  locked={editingLocked}
                />
              </View>
            </View>
          );
        }
        return (
          <View key={section.id} testID={`program-section-${section.id}`} style={{ gap: space.md }}>
            <SectionHeading
              title={section.title}
              blurb={section.blurb}
              issues={issues.count}
              stale={atRisk}
              testID={`program-heading-${section.id}`}
            />
            {section.fields.map((field) => (
              <Field
                key={field.name}
                field={field}
                value={(draft[field.name] as string | null | undefined) ?? ""}
                issues={issues.byField[field.name] ?? []}
                stale={atRisk}
                locked={editingLocked}
                onChange={(value) => set({ [field.name]: value } as Partial<ProgramDraft>)}
              />
            ))}
          </View>
        );
      })}

      {confirming ? (
        <ConfirmSheet
          action={confirming}
          atRisk={atRisk}
          busy={busyAction === confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const action = confirming;
            setConfirming(null);
            onAction(action);
          }}
        />
      ) : null}

    </ScrollView>
  );
}

/* ========================================================================== *
 * One field                                                                   *
 * ========================================================================== */

function Field({
  field,
  value,
  issues,
  stale,
  locked,
  onChange,
}: {
  field: StudioField;
  value: string;
  issues: ProgramIssue[];
  /** True when `issues` describe the last saved draft rather than what is in the box. */
  stale: boolean;
  /** True while a lifecycle request is in flight. See `editingLocked` on the props above. */
  locked: boolean;
  onChange: (value: string) => void;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [focused, setFocused] = useState(false);
  const bad = issues.length > 0 && !stale;

  return (
    <View testID={`program-field-${field.name}`} style={{ gap: space.xxs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{field.label}</Text>
        {!field.required ? (
          <Text style={[t.caption, { color: colors.inkFaint }]}>Optional</Text>
        ) : null}
      </View>
      {field.help ? (
        <Text style={[t.caption, { color: colors.mutedForeground }]}>{field.help}</Text>
      ) : null}
      <TextInput
        testID={`program-input-${field.name}`}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!locked}
        multiline={field.multiline}
        placeholder={field.placeholder}
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={field.label}
        accessibilityHint={field.help ?? undefined}
        style={[
          t.body,
          {
            color: colors.foreground,
            backgroundColor: colors.surfaceSunk,
            borderRadius: radius.xs,
            borderWidth: 1,
            // Focus is visible, and an unfinished field is visible without focus. Both matter on a
            // phone where a teacher cannot see a whole section at once.
            borderColor: bad ? colors.destructive : focused ? colors.primary : colors.border,
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
            minHeight: field.multiline ? HIT_SLOP_MIN * 2 : HIT_SLOP_MIN,
            textAlignVertical: field.multiline ? "top" : "center",
            opacity: locked ? 0.6 : 1,
          },
        ]}
      />
      {issues.map((issue) => (
        <IssueLine
          key={issue.code + issue.message}
          issue={issue}
          stale={stale}
          testID={`program-issue-${field.name}`}
        />
      ))}
    </View>
  );
}

/** The server's own sentence, beside the field it is about. Never reworded, never summarised. */
/**
 * One thing the server said was missing, and when it said it.
 *
 * `stale` is the difference between a claim and a record. Drawn in the destructive colour beside a
 * field a teacher has since filled in, the sentence is simply false — and red is the app's loudest
 * signal, so it is the false thing they look at first. Stale, it says which draft it was about, in
 * a colour that does not shout, and it keeps the guidance rather than hiding it.
 */
function IssueLine({
  issue,
  stale = false,
  testID,
}: {
  issue: ProgramIssue;
  stale?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const ink = stale ? colors.mutedForeground : colors.destructive;
  return (
    <View
      testID={testID}
      // An alert is a claim about now. What is stale is a note, and a screen reader should not
      // interrupt somebody mid-sentence to read out a fact about a draft they have moved past.
      accessibilityRole={stale ? "text" : "alert"}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xxs }}
    >
      <Feather name={stale ? "clock" : "alert-circle"} size={14} color={ink} />
      <Text style={[t.caption, { color: ink, flexShrink: 1 }]}>
        {stale ? `At your last save: ${issue.message}` : issue.message}
      </Text>
    </View>
  );
}

/* ========================================================================== *
 * The module editor                                                           *
 * ========================================================================== */

/**
 * The learning path: add, edit, remove, and move a step up or down.
 *
 * **No drag gesture anywhere.** The brief is explicit and the reason is the market: a long-press
 * drag on a cheap Android with a resistive-feeling screen is a gesture that fails often and has no
 * discoverable alternative. Two buttons work with a screen reader, with a keyboard, and with cold
 * fingers on a bus.
 *
 * Order is the array order and nothing else, which is the same rule the server applies — it
 * renumbers positions from the list it is sent, so what a teacher sees here is what is stored.
 */
function ModuleEditor({
  modules,
  issues,
  stale,
  locked,
  onChange,
}: {
  modules: ProgramModuleDraft[];
  issues: Record<number, ProgramIssue[]>;
  /** True when `issues` describe the last saved draft rather than the steps on screen. */
  stale: boolean;
  /** True while a lifecycle request is in flight. See `editingLocked` on the props above. */
  locked: boolean;
  onChange: (next: ProgramModuleDraft[]) => void;
}) {
  const colors = useColors();
  const { t, space } = useLayout();

  const update = (index: number, patch: Partial<ProgramModuleDraft>) => {
    onChange(modules.map((module, i) => (i === index ? { ...module, ...patch } : module)));
  };

  return (
    <View style={{ gap: space.sm }}>
      {modules.length === 0 ? (
        <Text testID="program-modules-empty" style={[t.callout, { color: colors.mutedForeground }]}>
          No steps yet. A program needs at least one before it can be published.
        </Text>
      ) : null}

      {modules.map((module, index) => (
        <ProgramCardShell key={index} testID={`program-module-${index}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text style={[t.overline, { color: colors.inkFaint }]}>STEP {index + 1}</Text>
            <View style={{ flex: 1 }} />
            <StepControl
              testID={`program-module-${index}-up`}
              icon="arrow-up"
              label={`Move step ${index + 1} up`}
              disabled={locked || !canMoveUp(index)}
              onPress={() => onChange(moveModule(modules, index, -1))}
            />
            <StepControl
              testID={`program-module-${index}-down`}
              icon="arrow-down"
              label={`Move step ${index + 1} down`}
              disabled={locked || !canMoveDown(index, modules.length)}
              onPress={() => onChange(moveModule(modules, index, 1))}
            />
            <StepControl
              testID={`program-module-${index}-remove`}
              icon="trash-2"
              label={`Remove step ${index + 1}`}
              tone="stopped"
              disabled={locked}
              onPress={() => onChange(modules.filter((_, i) => i !== index))}
            />
          </View>

          <ModuleField
            testID={`program-module-${index}-title`}
            label="Step name"
            value={module.title}
            locked={locked}
            onChange={(title) => update(index, { title })}
          />
          <ModuleField
            testID={`program-module-${index}-outcome`}
            label="What they will be able to do after it"
            value={module.outcome}
            locked={locked}
            onChange={(outcome) => update(index, { outcome })}
            multiline
          />

          {(issues[index] ?? []).map((issue) => (
            <IssueLine
              key={issue.field + issue.code}
              issue={issue}
              stale={stale}
              testID={`program-module-${index}-issue`}
            />
          ))}
        </ProgramCardShell>
      ))}

      <ProgramButton
        testID="program-modules-add"
        label="Add a step"
        icon="plus"
        spoken="Add a step to the learning path"
        disabled={locked}
        onPress={() => onChange([...modules, emptyModule()])}
        grow
      />
    </View>
  );
}

function StepControl({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "neutral",
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "neutral" | "stopped";
  testID?: string;
}) {
  const colors = useColors();
  const { radius } = useLayout();
  const ink = tone === "stopped" ? colors.destructive : colors.primary;
  return (
    <Text
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      /*
        Both spellings, deliberately.

        `accessibilityState` is what React Native reads on a phone. React Native **Web** 0.21 no
        longer does — it looks at `aria-disabled` — so on the web this control was drawn faded and
        announced as an ordinary, available button. A screen-reader user at the top of the list
        would have been told "Move step 1 up" with nothing to say it does nothing.
      */
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={{
        width: HIT_SLOP_MIN,
        height: HIT_SLOP_MIN,
        lineHeight: HIT_SLOP_MIN,
        textAlign: "center",
        borderRadius: radius.xs,
        backgroundColor: colors.surfaceSunk,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Feather name={icon} size={16} color={ink} />
    </Text>
  );
}

function ModuleField({
  label,
  value,
  onChange,
  locked = false,
  multiline = false,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** True while a lifecycle request is in flight. See `editingLocked` on the studio's props. */
  locked?: boolean;
  multiline?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xxs }}>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!locked}
        multiline={multiline}
        accessibilityLabel={label}
        style={[
          t.body,
          {
            color: colors.foreground,
            backgroundColor: colors.surfaceSunk,
            borderRadius: radius.xs,
            borderWidth: 1,
            borderColor: focused ? colors.primary : colors.border,
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
            minHeight: multiline ? HIT_SLOP_MIN * 1.5 : HIT_SLOP_MIN,
            textAlignVertical: multiline ? "top" : "center",
            opacity: locked ? 0.6 : 1,
          },
        ]}
      />
    </View>
  );
}

/* ========================================================================== *
 * Review and publish                                                          *
 * ========================================================================== */

/**
 * The two things a teacher needs to be able to tell apart, side by side.
 *
 * What they are editing, and what students can see. They are different objects on the server — the
 * draft columns and the frozen snapshot — and the whole reason the API is shaped that way is that a
 * teacher can revise without a student's page changing underneath them. A studio that showed only
 * one of them would hide the feature.
 */
function ReviewAndPublish({
  program,
  draft,
  approved,
  atRisk,
  saveState,
  locked,
  unplaced,
  onAction,
  busyAction,
}: {
  program: ProgramDetail;
  draft: ProgramDraft;
  approved: boolean;
  /** True while the screen holds work the server has not accepted. Gates everything but Delete. */
  atRisk: boolean;
  /** Only to tell "a save is on its way" apart from "you have not pressed Save yet". */
  saveState: SaveState;
  /** True while a lifecycle request is out: no second one may be started on top of it. */
  locked: boolean;
  unplaced: ProgramIssue[];
  onAction: (action: ProgramAction) => void;
  busyAction: ProgramAction | null;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const block = publishBlock(program, { approved });
  const actions = programActions(program);
  const offer = publishOffer(program);

  return (
    <View style={{ gap: space.md }}>
      {/* --------------------------------------------------- what students see */}
      <ProgramCardShell testID="program-review-live">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Feather name="users" size={16} color={colors.inkFaint} />
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>What students can see</Text>
        </View>
        {program.published ? (
          <>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>
              Version {program.published.version}, published from this program.
            </Text>
            {program.hasUnpublishedChanges ? (
              <ProgramNotice
                testID="program-review-unpublished"
                title="Your changes are not published yet"
                body={
                  "Students still see the version above. Nothing you have written since reaches them " +
                  "until you publish again."
                }
              />
            ) : (
              <Text testID="program-review-in-step" style={[t.callout, { color: colors.mutedForeground }]}>
                This matches what you have written here.
              </Text>
            )}
          </>
        ) : (
          <Text testID="program-review-never" style={[t.callout, { color: colors.mutedForeground }]}>
            Nothing yet. This program has never been published, so no student has seen it.
          </Text>
        )}
      </ProgramCardShell>

      {/* --------------------------------------------------------- the draft */}
      <ProgramCardShell testID="program-review-draft">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Feather name="edit-2" size={16} color={colors.inkFaint} />
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Your draft</Text>
        </View>
        <ReviewLine label="Name" value={draft.title} />
        <ReviewLine label="They will be able to" value={draft.outcome} />
        <ReviewLine label="Right for" value={draft.intendedLearner} />
        <ReviewLine label="Taught in" value={draft.teachingLanguage} />
        <ReviewLine
          label="Steps"
          value={draft.modules.length === 0 ? "" : `${draft.modules.length}`}
          numeric
        />
        {(draft.referenceName ?? "").trim().length > 0 ? (
          <ReviewLine
            label="Reference"
            value={`${draft.referenceName} — your own citation, which Fadko does not check`}
          />
        ) : null}
      </ProgramCardShell>

      {unplaced.length > 0 ? (
        <ProgramNotice
          testID="program-review-unplaced"
          tone="stopped"
          icon="alert-circle"
          title="Something needs attention that is not on this screen"
          body="It may belong to a kind of program you have switched away from."
        >
          {unplaced.map((issue) => (
            <IssueLine key={issue.field + issue.code} issue={issue} stale={atRisk} />
          ))}
        </ProgramNotice>
      ) : null}

      {/* ------------------------------------------------------------ publish */}
      {atRisk ? (
        /*
          Nothing that acts on the server's copy, while the screen holds something it has not got.

          Every one of these publishes, hides or files away the *last saved* draft and then takes
          the answer as the editor's new baseline — so pressing Publish over an unsaved paragraph
          would give students the older text and overwrite the newer. Withheld rather than drawn and
          refused, and the reason is on screen, because a greyed button with no sentence beside it
          is the mistake `.agents/memory/refusals-must-name-their-reason.md` exists about.

          Delete is the exception below: throwing the draft away is the thing being asked for.
        */
        <ProgramNotice
          testID="program-actions-blocked"
          tone="waiting"
          icon="save"
          title="Save your draft before publishing or changing its status"
          body={
            saveState === "saving"
              ? "Your save is on its way to the server. This will open when it lands."
              : "Publishing, taking down and archiving all act on the copy Fadko has, and that is " +
                "not what is on this screen yet."
          }
        />
      ) : block.blocked ? (
        <ProgramNotice
          testID={`program-publish-blocked-${block.code}`}
          tone={block.code === "incomplete" ? "waiting" : "neutral"}
          icon={block.code === "approval" ? "clock" : "info"}
          title={block.title}
          body={block.body}
        />
      ) : offer ? (
        <ProgramButton
          testID="program-publish"
          label={offer.label}
          icon="upload-cloud"
          emphasis="primary"
          busy={busyAction === "publish"}
          disabled={locked}
          spoken={offer.spoken}
          onPress={() => onAction("publish")}
          grow
        />
      ) : (
        /*
          Published, and the draft matches it. There is nothing to publish, so nothing is offered.

          Not a disabled button: publishing writes a new version server-side, and a version that
          contains no change is a false entry in the record of what students were given.
        */
        <Text testID="program-publish-unchanged" style={[t.callout, { color: colors.mutedForeground }]}>
          Students already have exactly this. Publish again once you have changed something and
          saved it.
        </Text>
      )}

      {/* --------------------------------------------------------- lifecycle */}
      <View style={{ gap: space.xs }}>
        {actions
          // Deleting is allowed with work at risk — see the notice above. Nothing else is.
          .filter((offer) => !atRisk || offer.action === "delete")
          .map((offer) => (
            <ProgramButton
              key={offer.action}
              testID={`program-action-${offer.action}`}
              label={offer.label}
              emphasis={offer.emphasis}
              busy={busyAction === offer.action}
              // Every other lifecycle button goes quiet while one is out. Two of these racing for
              // the same row lock is a program whose final state depends on which packet arrived
              // first, which is not something a teacher can be asked to reason about.
              disabled={locked && busyAction !== offer.action}
              spoken={offer.spoken}
              onPress={() => onAction(offer.action)}
              grow
            />
          ))}
      </View>

      {/*
        Said out loud, where a teacher would otherwise go looking for a Delete that is not there.

        Silence would read as a missing feature. This is a rule with a reason, and the reason is the
        one a teacher would agree with: the page is the only record of what students were promised.
      */}
      {actions.every((offer) => offer.action !== "delete") ? (
        <Text testID="program-delete-withheld" style={[t.caption, { color: colors.inkFaint }]}>
          This program has been published before, so it is kept rather than deleted. Archiving puts it
          away and keeps the record of what students were shown.
        </Text>
      ) : null}
    </View>
  );
}

function ReviewLine({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  const colors = useColors();
  const { t, space, numeric: tabular } = useLayout();
  const written = (value ?? "").trim();
  return (
    <View style={{ gap: space.xxs }}>
      <Text style={[t.caption, { color: colors.inkFaint }]}>{label}</Text>
      {written.length > 0 ? (
        <Text style={[t.body, numeric ? tabular : null, { color: colors.foreground }]}>{written}</Text>
      ) : (
        /*
          Not written yet, said as that rather than left blank.

          A blank line reads as a rendering failure, and an em dash reads as "none". "Not written
          yet" is the only one of the three that is true of a draft.
        */
        <Text style={[t.body, { color: colors.mutedForeground }]}>Not written yet</Text>
      )}
    </View>
  );
}

/* ========================================================================== *
 * Confirmation                                                                *
 * ========================================================================== */

/**
 * The one place a filled destructive button is allowed.
 *
 * DESIGN.md: destructive is text or an outline everywhere else, and the filled rust exists only on
 * a confirmation sheet "where nothing else is on screen to confuse it with". This is that sheet.
 */
function ConfirmSheet({
  action,
  atRisk,
  busy,
  onCancel,
  onConfirm,
}: {
  action: ProgramAction;
  /** Passed through to the copy: a delete agreed to while dirty must say the screen goes too. */
  atRisk: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const copy = confirmCopy(action, { atRisk });
  const destructive = action === "delete" || action === "archive" || action === "unpublish";
  const { bg, ink } = toneColours(destructive ? "stopped" : "live", colors);

  return (
    <View
      testID={`program-confirm-${action}`}
      accessibilityRole="alert"
      accessibilityViewIsModal
      style={{
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <View
          style={{
            width: space.xxl,
            height: space.xxl,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: bg,
          }}
        >
          <Feather name={destructive ? "alert-triangle" : "check"} size={18} color={ink} />
        </View>
        <Text style={[t.title3, { color: colors.foreground, flexShrink: 1 }]}>{copy.title}</Text>
      </View>
      <Text style={[t.body, { color: colors.mutedForeground }]}>{copy.body}</Text>
      <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
        <ProgramButton
          testID={`program-confirm-${action}-cancel`}
          label="Keep it as it is"
          emphasis="quiet"
          onPress={onCancel}
          grow
        />
        <ConfirmAction
          testID={`program-confirm-${action}-go`}
          label={copy.confirm}
          destructive={destructive}
          busy={busy}
          onPress={onConfirm}
        />
      </View>
    </View>
  );
}

function ConfirmAction({
  label,
  destructive,
  busy,
  onPress,
  testID,
}: {
  label: string;
  destructive: boolean;
  busy: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <Text
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Both spellings, for the reason given on `StepControl` above.
      accessibilityState={{ busy }}
      aria-busy={busy}
      aria-disabled={busy}
      onPress={busy ? undefined : onPress}
      style={[
        t.bodyStrong,
        {
          flexGrow: 1,
          flexBasis: "auto",
          minHeight: HIT_SLOP_MIN,
          lineHeight: HIT_SLOP_MIN,
          textAlign: "center",
          borderRadius: radius.sm,
          paddingHorizontal: space.md,
          color: colors.onInverse,
          backgroundColor: destructive ? colors.destructive : colors.primary,
          opacity: busy ? 0.6 : 1,
        },
      ]}
    >
      {label}
    </Text>
  );
}
