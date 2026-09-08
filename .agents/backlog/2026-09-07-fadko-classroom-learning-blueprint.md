# Fadko classroom and learning experience blueprint

Status: recommended product contract awaiting the owner's final confirmation of the three defaults
called out below. This is a product and implementation guide, not authority to merge the LiveKit
pilot, enable a provider, change payments, migrate production data or record classes.

## The product idea

Fadko should feel like a purpose-built classroom, not a meeting application wrapped around a
marketplace. Borrow:

- ClassIn's teaching choreography and teacher control;
- Ledu's small-group, outcome-led learning journey;
- Aiwen Cloud's connected preparation, class, practice and reporting workflow;
- none of their China-only acquisition model, heavy client assumptions or institutional rigidity.

The resulting product remains distinctly Fadko: independent Nepal-based teachers, school subjects
and non-school skills in one system, a whiteboard-first classroom, licensed-provider payments, low
bandwidth operation and honest human support.

## Three default decisions

These are the recommended defaults. Change them only with a recorded owner decision.

1. **Board-first stage.** The teacher's video remains visible. Students begin as audience members
   and use Ask to Speak, chat, quick checks or a private scratch board until invited. Do not start
   every learner's camera.
2. **Meaningful feedback, not game currency.** Use teacher acknowledgement, completed outcomes,
   progress notes and private encouragement. No coins, public leaderboard, purchasable reward,
   manipulative streak or casino-like selector.
3. **Evidence plus board, not automatic video recording.** Preserve attendance, connection
   quality, teacher/student classroom actions, chat, lesson notes and a board artifact. Ordinary
   classes are not recorded by default. Any later recording requires explicit teacher and
   student/guardian consent, retention rules, visible status and measured cost.

## Rules that apply everywhere

- A class is a learning space, not a generic video meeting.
- The shared whiteboard is the primary surface. Video and controls float without hiding tools.
- Teacher authority is enforced by the server/provider, never only by hiding client buttons.
- A teacher may invite or remove publishing permission and may mute participants. Fadko must never
  remotely turn on a child's microphone or camera; the student accepts locally.
- “Ask to Speak” or “Ask a Question” is the learner action. Avoid the unexplained meeting term
  “Raise Hand” as the only label.
- Discussion Mode is an entitlement, not a visual toggle. Initially it belongs only to the approved
  recurring Monthly product; a future offering must explicitly carry the same entitlement. It is
  never inferred from a generic Learning Program label or enabled for a Single Class.
- Discussion Mode may be started only during the final 20 minutes before the booked finish. A
  running discussion may continue through the existing classroom grace period, but a new one may
  not start after the paid slot.
- Default student delivery subscribes to the teacher. Additional student video is selective,
  adaptive and bounded; never render every available stream on a cheap phone.
- Every money, attendance, progress and quality statement comes from an authoritative record. Do
  not turn activity, permission or connection telemetry into a claim about learning quality.
- Every feature needs loading, slow, offline, empty, failed and retry behavior appropriate to its
  state. Failed is never rendered as empty; pending is never rendered as complete.
- Use the existing design tokens, 44x44 minimum targets, visible labels, large-text resilience and
  keyboard/screen-reader behavior. Premium means calm hierarchy and exact language, not gradients,
  blur, continuous animation or dense card grids.

## The Fadko lesson lifecycle

### 1. Prepare

Teacher:

- sees the lesson outcome, module and enrolled learners;
- may prepare or restore a board and attach lightweight material;
- may add a short lesson plan: Explain, Try Together, Student Practice, Questions;
- sees missing setup honestly rather than a fabricated readiness percentage.

Student:

- sees the lesson outcome, time, teacher, required material and preparation task;
- can perform a plain-language camera, microphone, speaker and connection check;
- may continue in low-bandwidth mode when video quality is poor;
- is never blocked merely because an optional camera is unavailable.

Recommended later addition: an optional readiness check for placement or prerequisites. It guides
the learner and teacher; it is not an entrance exam and does not fabricate a proficiency level.

### 2. Learn live

Always available:

- shared whiteboard;
- teacher video with compact/normal/full/hide states;
- Fadko class chat only;
- materials;
- Ask to Speak / Ask a Question;
- restrained reactions or acknowledgements that expire;
- visible connection help;
- accessible Leave action.

Teacher controls:

- invite one learner to microphone or camera;
- invite eligible learners to speak;
- mute one or mute all;
- revoke one learner's camera;
- return one or all learners to the audience;
- spotlight a learner answer without granting moderator rights;
- switch between Focus Board and Focus Discussion layouts;
- see provider changes as pending/failed until confirmed.

Student controls:

- ask or cancel a request;
- accept or decline an invitation;
- turn their own granted microphone/camera off;
- never receive screen-share or moderator authority;
- receive a human explanation if the media provider has not applied a change.

### 3. Check understanding

Build inexpensive interaction before expensive simulations:

1. **Quick Check** — one-question multiple choice, Yes/Not Yet, or 1–5 confidence. The teacher sees
   aggregate and individual answers; students do not see a public ranking.
2. **My Scratch Board** — a private, lightweight answer surface. A student deliberately sends a
   snapshot/answer to the teacher; it does not continuously synchronize every student's drawing.
3. **Spotlight Answer** — the teacher may place one submitted answer beside the main board and
   annotate it.
4. **Short timer** — an optional accessible timer for a task, without sound/animation overload.

These reproduce the useful teaching purpose of ClassIn's responder, small blackboard and selector
without its heavier classroom client or game-show presentation.

### 4. Discuss

For the entitled Monthly classroom only:

- the teacher sees “Start Discussion” only inside the final 20-minute window;
- students see “Discussion is open” and may opt into microphone/camera;
- teacher mute-all and individual controls remain available;
- phone layout shows the teacher plus a small bounded number of relevant student videos;
- overflow participants remain in a named roster rather than generating hidden video streams;
- low-bandwidth mode may keep cameras off while preserving audio, board and chat;
- ending Discussion returns students to the audience and provider permissions are confirmed.

The system must not call “Invite all” an automatic unmute. It grants/requests an opportunity; each
student chooses whether to activate their device.

### 5. Practice and progress

After class, show one useful learning page rather than a recording library:

- what the lesson intended to cover;
- teacher-confirmed topics actually covered;
- saved board artifact or teacher-selected board pages;
- materials and practice/homework;
- submission status and teacher feedback;
- next lesson and preparation;
- attendance and schedule changes in plain language;
- course conversation using the existing Fadko message architecture.

Progress is module/outcome based. Do not invent a percentage from attendance alone. “Completed”
requires a stable definition such as teacher-confirmed module coverage plus the program's declared
completion evidence.

For a minor, a later guardian view may summarize attendance, teacher feedback, preparation and the
next class. It must not expose private student chat or classroom media without a separate privacy
decision.

## Learning Program structure

The program is the promise; the session remains the delivery and access-control unit.

Every published program needs:

- a specific learner outcome;
- intended learner and starting level;
- teaching language;
- prerequisites and equipment when relevant;
- ordered modules and module outcomes;
- an understandable schedule and time commitment;
- capacity;
- teacher identity and separately verified claims;
- practice/feedback expectations;
- honest completion method;
- a versioned cancellation/refund summary;
- total price and unit only after server-owned commerce exists.

Conditional templates:

- School Subject: grade/level and optional named curriculum.
- Practical Skill: equipment, starting ability and demonstrated outcome.
- Language: current level, target use and spoken/written emphasis.
- Exam Preparation: exact examination, syllabus/source and no pass guarantee.
- Custom: audience, prerequisites, outcome and teacher-defined evidence.

Recommended discovery order:

1. What do you want to learn?
2. Programs, Single Classes or Teachers.
3. Outcome, level, language, schedule and format.
4. Teacher and verified evidence.

Keep teacher search, but do not force every student to choose a teacher before understanding the
learning offer.

## Quality, support and refund evidence

Borrow operational visibility, not silent surveillance.

The operator's session view may summarize:

- booking and payment confirmation state;
- scheduled, started and ended times;
- participant joins/leaves and presence duration;
- provider-confirmed connection intervals and quality samples;
- teacher camera/microphone state when provider-confirmed;
- first board activity and board-change counts;
- chat/message facts and read state when implemented;
- Discussion invitations, permissions and floor-held time;
- technical gaps and unavailable evidence.

It may not automatically decide who taught well, who is lying or who receives money. Operator
access to a live room, if ever built, must be visible to all participants, role-authorized,
audited and exceptional—not a hidden supervisor camera.

## Feature adoption matrix

### Build now or in the current bounded tracks

- Server-enforced audience/stage authority.
- Ask to Speak / Ask a Question.
- Individual and whole-class mute/revoke controls.
- Monthly-only final-20-minute Discussion Mode.
- Provider pending/failure truth.
- Human-readable session evidence.
- Learning Program outcome, type, modules and publication contract.
- Provider-neutral classroom and payment boundaries.

### Build after the program foundation is reviewed

- Teacher program builder and exact student preview.
- Outcome-first Program Card and program detail.
- Lesson preparation view.
- Quick Check.
- Focus Board / Focus Discussion.
- Saved board artifact chosen at lesson end.
- Program home with next lesson, practice and feedback.
- Four realistic pilots: Grade 10 Mathematics, Beginner Guitar, Spoken English and Engineering
  Registration Exam Preparation.

### Build after real-device and low-bandwidth measurement

- My Scratch Board and teacher spotlight.
- Selective student video grid.
- Guardian progress view.
- Teacher-created trial lesson.
- Automatic but evidence-limited learning reports.
- Optional teacher-selected recording, only after consent/cost/privacy design.

### Later or only with proven demand

- Breakout rooms.
- Multiple co-teachers/assistants.
- Rich test bank.
- Collaborative document editing.
- Virtual science laboratories.
- AI subtitles, summaries or grading.
- Hybrid physical-classroom hardware.
- Large webinars or public livestreams.

### Do not copy

- Mandatory automatic recording.
- All-student camera grids by default.
- Public rankings, coins, streak pressure or casino-like random selectors.
- Heavy animated courseware as a launch requirement.
- A proprietary desktop client requirement.
- Silent operator observation.
- Remote activation of a student's microphone/camera.
- China-only WeChat acquisition, phone-verification or institutional-school assumptions.
- Claims such as zero latency, perfect connection, guaranteed exam results or automated refund
  certainty.

## Cost discipline

- Teacher video is the primary subscribed stream.
- Student video exists only when the teacher grants it or Discussion Mode allows it.
- Use adaptive subscription/simulcast and stop receiving invisible video.
- Quick Checks and Scratch Board answers use small data messages or compressed snapshots, not new
  video streams.
- Board artifacts are snapshots/structured scene data, not full-screen recordings.
- Do not record every class to prove delivery; session evidence is the default.
- Measure participant-minutes, egress, reconnection success, CPU, battery and time-to-first-media
  on Nepal-like networks before selecting or pricing a provider.

## Premium interaction language

Preferred:

- Ask to Speak
- Ask a Question
- Your teacher invited you to speak
- Start Discussion
- Focus on Board
- Focus on Discussion
- Quick Check
- Try on My Board
- Send Answer to Teacher
- Preparing the class video…
- The class could not confirm this change

Avoid unexplained or misleading labels:

- Raise Hand as the only description
- Go on stage / Downstage
- Force unmute
- AI score
- Engagement percentage
- Perfect attendance when presence is incomplete
- Session recorded when only activity evidence exists

## Implementation boundaries for Claude and Codex

- Each phase gets its own branch, worklog, tests and review.
- LiveKit provider work remains isolated until Cloud and real-device verification.
- Learning Program schema/API remains isolated from classroom and commerce.
- Classroom teaching tools reuse the existing session ID, membership, socket, whiteboard and chat;
  they do not create a second classroom protocol without justification.
- Payment, lesson allocation, payout and refund work does not begin from this feature document.
- No production schema push or provider activation follows automatically from code completion.
- Every feature report states what was not built and what was not tested.

## Reference basis

Official product material reviewed 2026-09-07:

- ClassIn education model and management: https://www.classin.com/education/
- ClassIn classroom, reports and course management: https://www.classin.com/k12/
- ClassIn SDK capabilities: https://www.classin.com/sdk/
- ClassIn independent-teacher prepare/live/after flow:
  https://www.classin.com/independent_teacher/
- ClassIn current plan comparison: https://www.classin.com/pricing/
- Aiwen Cloud institution workflow: https://dev.aiwenyun.cn/
- Aiwen real-time classroom guide: https://help.aiwenyun.cn/teacher/6951
- Aiwen audio/video participation controls: https://help.aiwenyun.cn/teacher/660c
- Ledu small-group and structured-course model: https://www.ledupeiyou.com/

The sources show product behavior and vendor claims, not proof of suitability on Nepal networks.
Fadko should reproduce the learning purpose through its own lightweight system, not copy protected
visual assets, proprietary implementation or marketing claims.
